# Trackify deployment architecture

Trackify is one monorepo with independently deployed products. The clients share contracts and API
code but never host backend business logic.

## Components

| Component       | Source                             | Deployment                                | Scaling and idle behavior                              |
| --------------- | ---------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Backend         | `services/`, `packages/`, `infra/` | AWS CDK in `ap-south-1`                   | Lambda, API Gateway, SQS and DynamoDB scale by request |
| Web dashboard   | `apps/dashboard-web/`              | Amplify Hosting static export             | CDN files only; no Next.js server or SSR compute       |
| Mobile app      | `apps/mobile/`                     | Expo EAS, Google Play and Apple App Store | Runs on user devices and calls the same backend        |
| Tracker gateway | `apps/tracker-gateway/`            | ECS Fargate behind NLB                    | Opt-in because persistent TCP requires idle compute    |
| Shared client   | `packages/api-client/`             | Bundled into web and mobile               | One API/auth contract for both clients                 |

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

The Expo app uses the same custom Cognito login and API as the dashboard. App-store builds require
Expo, Apple, and Google developer accounts; no store credentials belong in source.

```bash
cd platform/apps/mobile
npx expo start
npx eas build --platform android --profile preview
npx eas build --platform ios --profile preview
```

Use production EAS profiles only after push notification credentials, privacy disclosures, signing,
real-device authentication, and background-location behavior are reviewed.

## Scale boundaries

- SQS FIFO orders messages per vehicle while processing vehicles in parallel.
- DynamoDB keys partition live and historical data by tenant and vehicle.
- Lambda has no idle compute and can raise concurrency independently for API and ingestion.
- AppSync distributes realtime updates without holding application servers open.
- Amplify and mobile clients scale independently of backend processing.
- The tracker gateway scales by connection count and remains the only always-on service.
