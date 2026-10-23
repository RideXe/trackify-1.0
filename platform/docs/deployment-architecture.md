# Trackify deployment architecture

Trackify is one monorepo with independently deployed products. The clients share contracts and API
code but never host backend business logic.

## Components

| Component       | Source                             | Deployment                                 | Scaling and idle behavior                              |
| --------------- | ---------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Backend         | `services/`, `packages/`, `infra/` | AWS CDK in `ap-south-1`                    | Lambda, API Gateway, SQS and DynamoDB scale by request |
| Web dashboard   | `apps/dashboard-web/`              | Amplify Hosting static export              | CDN files only; no Next.js server or SSR compute       |
| Mobile app      | `apps/mobile/`                     | React Native Android (Gradle), Google Play | Runs on user devices and calls the same backend        |
| Tracker gateway | `apps/tracker-gateway/`            | ECS Fargate behind NLB                     | Opt-in because persistent TCP requires idle compute    |
| Shared client   | `packages/api-client/`             | Bundled into web and mobile                | One API/auth contract for both clients                 |

## Backend deployment

The default deployment excludes the paid TCP gateway, public legacy phone URL, and Firehose
archive. Enable each only after its launch gate is complete.

Install the workspace first (`npm ci` in `platform/`), then run `cdk diff` with the same flags
before every deploy:

```bash
cd platform/infra
npx cdk deploy --all --profile bgt \
  -c env=dev -c account=396913392905 -c region=ap-south-1 \
  -c alertEmail=santhoshrdevadiga@gmail.com \
  -c dashboardUrl="https://track.bgthub.com" \
  -c enableGateway=false -c allowLegacyPhoneIngest=false -c enableArchive=false
```

`dashboardUrl` is required. It sets the API's allowed browser origin (CORS), driver setup links
and alert-email links; without it they silently fall back to `http://localhost:5173` and the
hosted dashboard cannot reach the API. Only that one dashboard origin (plus localhost in dev and
the CloudFront dashboard) is allowed, so the old `*.amplifyapp.com` address no longer works.

### Live development environment

| Item          | Value                                                                        |
| ------------- | ---------------------------------------------------------------------------- |
| AWS account   | `396913392905`, region `ap-south-1`, CLI profile `bgt`                       |
| Dashboard     | `https://track.bgthub.com` (Amplify app `d2psibrecnh42n`, branch `dev`)      |
| Custom domain | `bgthub.com` DNS is at Hostinger; `track` is a CNAME to Amplify's CloudFront |
| API           | `Trackify-dev-Api` stack output `ApiUrl`                                     |

The `bgthub.com` root and `www` records point to a separate website on Vercel. Only the `track`
subdomain belongs to Trackify, so never map the root or `www` in Amplify's custom-domain settings.

### Alarms

`Trackify-<env>-Alerts` owns one SNS topic that emails `alertEmail`. After its first deploy AWS
sends a subscription confirmation email; no alarm email arrives until the link is clicked. Each
stack adds its own CloudWatch alarms (10 in total, within the free tier), and each sends an email
when it fires and again when it clears:

| Stack         | Alarm                                                               |
| ------------- | ------------------------------------------------------------------- |
| Ingest        | Processing errors; dead-letter queue not empty; backlog over 60 s   |
| Notifications | Notify errors; scheduled-report errors; dead-letter queue not empty |
| Api           | Fleet API errors; phone ingest errors; 5+ API 5xx in 5 minutes      |
| Operations    | Offline sweep errors                                                |

Lambda error alarms fire at 3 or more failures in 5 minutes. Every API route is throttled at
1,000 requests/s (burst 2,000), and the public driver-app download at 2/s.

## Amplify dashboard

Connect the GitHub repository `RideXe/trackify-1.0` in Amplify Hosting and select the repository
root. The root `amplify.yml` installs the npm workspace and exports `apps/dashboard-web` as static
files. Configure these non-secret build variables when endpoints differ from development:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_AWS_REGION`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_REALTIME_DNS`

Security response headers (HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`) come from `customHttp.yml` in the repository root and apply on the next
Amplify build. The Content-Security-Policy there is report-only: open the dashboard, use every
page, and check the browser console for CSP violations before renaming the header to
`Content-Security-Policy` to enforce it.

The web and mobile clients show a Trackify email/password form and send credentials directly to the
Cognito authentication API over TLS. Passwords are never stored by either client. Cognito returns
short-lived access tokens and handles the first-login password-change challenge. Keep CloudFront
hosting until the Amplify URL passes login, API, realtime, and route-reload checks.

When an administrator signs in to an empty fleet, the dashboard opens first-vehicle onboarding.
The form registers a GT06, Teltonika, or phone identifier through the tenant-scoped API. Hardware
and phone connection instructions remain explicit about disabled ingestion paths so onboarding does
not silently enable an always-on gateway or a public endpoint.

## Mobile builds

`apps/mobile` is a plain React Native (0.86) Android app with no Expo dependency. It uses the same
custom Cognito login and API as the dashboard. iOS is not set up yet (there is no `ios/` project).

Background tracking is app-local native code in
`android/app/src/main/java/com/ridexe/trackify/location/`: a foreground service receives fused
location updates and passes each fix to the JS task registered in `index.js`, which queues and
uploads it (`src/services/upload.ts`). Its JS contract is `src/native/NativeTrackifyLocation.ts`.

Requirements: JDK 17, Android SDK platform 36, and NDK 27.1.12297006 (install through Android
Studio). The fleet map uses MapLibre with OpenFreeMap tiles (OpenStreetMap data), so no map API key,
account, or billing is needed. Develop against an emulator or USB device:

```bash
cd platform
npm start -w @trackify/mobile          # Metro bundler; leave running
npm run android -w @trackify/mobile    # build, install and open the debug app
```

Release builds are signed with the upload keystore, which never belongs in source. Add
`TRACKIFY_UPLOAD_STORE_FILE`, `TRACKIFY_UPLOAD_STORE_PASSWORD`, `TRACKIFY_UPLOAD_KEY_ALIAS`, and
`TRACKIFY_UPLOAD_KEY_PASSWORD` to `local.properties` (or pass them as Gradle properties or
environment variables), then build the Play Store bundle:

```bash
cd platform/apps/mobile/android
./gradlew bundleRelease   # app/build/outputs/bundle/release/app-release.aab
```

Without those values, release builds fall back to the debug key and are for local testing only.
Raise `versionCode` in `android/app/build.gradle` for every Play upload. If earlier builds were
published through Expo EAS with EAS-managed signing, download that keystore once with
`eas credentials` and use it as the upload keystore.

Publish to production only after privacy disclosures, signing, real-device authentication, and
background-location behavior are reviewed.

## Scale boundaries

- SQS FIFO orders messages per vehicle while processing vehicles in parallel.
- DynamoDB keys partition live and historical data by tenant and vehicle.
- Lambda has no idle compute and can raise concurrency independently for API and ingestion.
- AppSync distributes realtime updates without holding application servers open.
- Amplify and mobile clients scale independently of backend processing.
- The tracker gateway scales by connection count and remains the only always-on service.
