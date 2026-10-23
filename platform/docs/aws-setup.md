# AWS setup

The CDK application now includes the complete serverless foundation, data, identity, API, realtime,
dashboard, archive, ingestion, and maintenance stacks. The raw TCP gateway remains opt-in because
it is the only component with unavoidable idle compute and load-balancer cost. All commands below
are for the operator; CI and local validation never bootstrap or deploy.

## Preparation

Use separate dev and prod accounts with IAM Identity Center and short-lived credentials.
Enable MFA and confirm the selected account in the AWS console. Start in Mumbai (`ap-south-1`).
Check existing account budgets and Cost Anomaly Detection monitors before creating duplicates.
The budget covers the entire account, not just Trackify. Forecast alerts require billing history.

From `platform/`, restore approved dependencies if necessary and run `npm run check`.
Before any bootstrap or deploy, inspect the resulting template and IAM permissions. Bootstrapping
creates asset storage and roles and can incur storage costs. Never put access keys in source.

## Operator commands

Replace ACCOUNT_ID, ALERT_EMAIL, and PROFILE; do not deploy the placeholder check configuration.
From `platform/infra/`:

```sh
npx cdk bootstrap aws://ACCOUNT_ID/ap-south-1 --profile PROFILE
npx cdk synth -c env=dev -c account=ACCOUNT_ID -c alertEmail=ALERT_EMAIL --profile PROFILE
npx cdk diff -c env=dev -c account=ACCOUNT_ID -c alertEmail=ALERT_EMAIL --profile PROFILE
npx cdk deploy --all -c env=dev -c account=ACCOUNT_ID -c alertEmail=ALERT_EMAIL --profile PROFILE
```

Defaults: dev budget $10/month, prod $50/month. Override with `-c monthlyBudgetUsd=VALUE`.
Notifications fire above 80% forecast and 100% actual. They do not enforce a spending limit.

Anomaly detection is disabled by default. Attach an existing monitor with
`-c anomalyMonitorArn=ARN`, or, only after checking for an existing service monitor,
use `-c createAnomalyMonitor=true`. These options are mutually exclusive.
`-c anomalyThresholdUsd=5` controls the daily email threshold.

## Optional features

Each is off unless its context value is given; all go on the same `cdk deploy` command.

| Context                                                                                                             | What it turns on                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-c emailSender=alerts@your-domain`                                                                                 | Alert and scheduled-report emails through SES. AWS emails a verification link to that address first; new SES accounts are in the sandbox and can only send to verified recipients until production access is granted. |
| `-c geocoding=true`                                                                                                 | Street addresses for trip starts/ends and alerts (Amazon Location, billed per lookup).                                                                                                                                |
| `-c oidcName=Microsoft -c oidcIssuerUrl=https://… -c oidcClientId=… -c oidcClientSecretName=trackify/sso/microsoft` | Single sign-on through any OpenID Connect provider. Create the Secrets Manager secret (plain-text client secret) before deploying.                                                                                    |
| `-c googleClientId=… -c googleClientSecretName=trackify/sso/google`                                                 | Google sign-in.                                                                                                                                                                                                       |

Only invited users can sign in with single sign-on; their first SSO sign-in is linked to the
invited account with the same email. Some Cognito versions reject that very first attempt with
"Already found an entry for username"; signing in again succeeds.

**Notification channel credentials.** The Notifications stack outputs the name of a Secrets
Manager secret. Set its value (console or CLI) to the JSON for the channels you use; leave out the
rest:

```json
{
  "fcm": {
    "projectId": "…",
    "clientEmail": "…@….iam.gserviceaccount.com",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n…"
  },
  "telegram": { "botToken": "…" },
  "whatsapp": {
    "token": "…",
    "phoneNumberId": "…",
    "templateName": "fleet_alert",
    "templateLanguage": "en"
  },
  "pushover": { "appToken": "…" }
}
```

SMS goes through SNS: in a new account, request SMS production access (and for India, register
the sender ID and DLT templates) before alerts can reach unverified numbers.

**Importing from the legacy server.** `tools/legacy-import` reads the legacy REST API and
prints what it would import (vehicles, groups, geofences, drivers, notifications as alert rules,
maintenance, computed attributes) and the users to invite. Nothing is written without `--apply`.
See `npm start -w @trackify/legacy-import` for its options.

## Later deployment gates

Before ingestion: verify tracker model and firmware, authentication, buffering, and acknowledgement
behavior. Check regional service quotas and expected burst rate. Before live customers: perform a
restore test, replay/retry tests, cross-tenant isolation tests, live subscription authorization,
a measured cost test, and protocol-specific reconnect tests. SES sandbox exit is needed before
general email delivery. Do not enable production command execution until expiry and authorization
tests pass.

The production launch remains blocked until tracker-specific command encoders are verified on the
exact hardware models, archived data is restored in a rehearsal, tenant isolation is security
reviewed, and measured reconnect/load tests pass. Engine-control commands may be queued only by an
administrator and expire automatically; the gateway does not transmit them yet.
