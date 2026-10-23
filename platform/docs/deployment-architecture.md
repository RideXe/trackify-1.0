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

```bash
cd platform/infra
npx cdk deploy --all --profile bgt --require-approval never \
  -c env=dev -c account=396913392905 -c region=ap-south-1 \
  -c alertEmail=santhoshrdevadiga@gmail.com \
  -c enableGateway=false -c allowLegacyPhoneIngest=false -c enableArchive=false
```

## Amplify dashboard

Connect the GitHub repository `RideXe/trackify-1.0` in Amplify Hosting and select the repository
root. The root `amplify.yml` installs the npm workspace and exports `apps/dashboard-web` as static
files. Configure these non-secret build variables when endpoints differ from development:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_AWS_REGION`
- `NEXT_PUBLIC_COGNITO_CLIENT_ID`
- `NEXT_PUBLIC_REALTIME_DNS`

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
