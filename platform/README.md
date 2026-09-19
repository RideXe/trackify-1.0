# Trackify platform

Serverless fleet-tracking rewrite. The legacy applications remain alongside this folder while the
new platform is tested and migrated.

Implemented locally: GT06 and Teltonika ingestion, phone ingestion, ordered processing, GPS quality
filtering, trips, geofences, overspeed and offline events, DynamoDB reports, command authorization and
expiry, Cognito identity, tenant-safe APIs, AppSync live updates, route/history dashboard, compressed
S3 archive, private hosting, cost guardrails, and a simulator. Tracker-specific command delivery,
customer notification preferences, migration rehearsal, and production load testing remain launch
gates. Nothing is deployed by this repository checkout.

## Local checks

Use Node.js 24 (see `.nvmrc`). Dependencies are pinned in `package-lock.json`.
From this folder, run `npm ci` when dependencies need restoring, then `npm run check`.

`npm run check` runs lint, formatting, type checking, tests, and local CloudFormation synthesis.
Synthesis uses placeholder account `111111111111` and email `alerts@example.com`; it does not
deploy anything. Output is ignored under `infra/cdk.out/`.

## Navigation

- [Plan and delivery gates](docs/PLAN.md)
- [Draft data access patterns](docs/data-access-patterns.md)
- [Cost model and assumptions](docs/cost-model.md)
- [AWS setup and manual deployment](docs/aws-setup.md)
- [Architecture decisions](docs/adr/0001-typescript-everywhere.md)

CI runs the same checks with read-only repository permissions and no AWS credentials.
Budget alerts are notifications, not spending caps. The raw TCP gateway is deliberately disabled
by default because its Fargate task and Network Load Balancer have idle cost.

## Development deployment and first administrator

The default deployment creates request-priced services and the HTTPS dashboard while leaving the
paid TCP gateway off. Firehose, EventBridge Pipes, S3, Lambda, API Gateway, DynamoDB on-demand, and
the one-minute maintenance schedule charge by usage and have no dedicated always-on compute.

```bash
cd infra
npx cdk deploy --all -c env=dev -c account=<12-digit-account> -c alertEmail=<email>
```

After deployment, copy `UserPoolId` and the Core table physical name from CloudFormation. Create
the first tenant administrator with an AWS CLI session for the target account:

```bash
cd ..
npm start -w @trackify/bootstrap-tenant -- \
  --email admin@example.com \
  --tenant-name "Example Fleet" \
  --user-pool-id <UserPoolId> \
  --core-table <CoreTableName>
```

Cognito emails a temporary-password invitation. Open the `DashboardUrl` output and sign in. Enable
the TCP gateway only for a physical-device pilot:

```bash
npx cdk deploy Trackify-dev-Gateway \
  -c env=dev -c account=<12-digit-account> -c alertEmail=<email> \
  -c enableGateway=true -c gatewayNlb=true
```
