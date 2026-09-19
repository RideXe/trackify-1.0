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
