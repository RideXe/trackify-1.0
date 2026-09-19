# Trackify v2 — platform plan

A rewrite of the Trackify GPS platform for car fleets: serverless, scales automatically, and costs
very little when idle. The legacy Java server in `../../trackify/` stays as a reference (protocol
decoders, test samples, business logic) until the new platform reaches parity.

## 1. Targets

| Area           | Target                                                                              |
| -------------- | ----------------------------------------------------------------------------------- |
| Capacity       | Designed for 100,000 cars without architecture changes; load-tested at 10,000       |
| Data safety    | A tracker is acknowledged after durable queue acceptance where its protocol permits |
| Live map delay | Tracker → dashboard under 5 s (p95)                                                 |
| Processing lag | Oldest unprocessed message under 30 s; a 2-hour backlog clears in under 25 min      |
| API latency    | Interactive calls under 500 ms (p95)                                                |
| Idle cost      | Measured before launch; raw TCP requires an always-on gateway                       |
| Availability   | 99.9% dashboard and API · gateway 99.5% (starter) → 99.9% (multi-AZ switch)         |
| Retention      | Positions 90 days hot, 2+ years archived (per-tenant configurable)                  |

## 2. Architecture

```
DEVICES
 TCP/UDP trackers ─► gps.<domain> ─► Gateway (Fargate ARM, 1→N tasks) ─┐
 MQTT trackers    ─► IoT Core (Basic Ingest) ─► IoT Rule ─► Lambda ────┤
 Phones           ─► Lambda Function URL ──────────────────────────────┤
                                                                       ▼
                      SQS FIFO (message group = car → strict order per car)
                                          │
                                Lambda "process" (batched, idempotent)
    ┌──────────────┬──────────────┬────────┴───────┬────────────────────┐
 DeviceState    Positions      Events · Trips   Firehose → S3      Lambda "notify"
 (+ Streams)    (90-day TTL)   · DailyStats     (Parquet) → Athena  → FCM / SES / SMS
    │
 Lambda "fanout" (1–2 s batches) ─► AppSync Events ─► dashboards and apps

USERS    Browser ─► CloudFront ─┬─ /*     → S3 (React dashboard)
                                └─ /api/* → API Gateway HTTP API (Cognito JWT) → Lambdas
COMMANDS API ─► Commands table ─► GatewaySessions lookup ─► that task's queue ─► car
         (car offline → delivered on reconnect)
JOBS     EventBridge Scheduler ─► offline sweep · scheduled reports
```

Only the gateway is always on, and only when TCP trackers are used.

## 3. Technology choices

| Concern         | Choice                                                   | ADR                                              |
| --------------- | -------------------------------------------------------- | ------------------------------------------------ |
| Language        | TypeScript everywhere (Node.js 24 on Lambda and Fargate) | [0001](adr/0001-typescript-everywhere.md)        |
| Ingest backbone | SQS FIFO, grouped by car; Kinesis switch at ~5,000 cars  | [0002](adr/0002-sqs-fifo-backbone.md)            |
| Data store      | DynamoDB on-demand + S3/Athena archive                   | [0003](adr/0003-dynamodb-data-model.md)          |
| Live updates    | AppSync Events channels                                  | [0004](adr/0004-appsync-events-realtime.md)      |
| Tracker address | DNS first, NLB with static IPs behind a switch           | [0005](adr/0005-gateway-dns-first-nlb-switch.md) |
| Identity        | Cognito user pools, tenant in the token                  | [0006](adr/0006-cognito-auth-and-tenancy.md)     |
| Infrastructure  | AWS CDK (TypeScript), scale switches as config           | —                                                |
| Region          | ap-south-1 (Mumbai), separate dev and prod accounts      | —                                                |

## 4. Data

See [data-access-patterns.md](data-access-patterns.md) — the sign-off document for phase 1. Rule:
every query is a key lookup or a bounded range query. Anything else belongs in Athena.

## 5. Processing pipeline

Per car, in order:

1. Validate the message against the shared schema (`@trackify/domain`).
2. Drop duplicates (write keyed on car + fix time).
3. Late data: store in history, never move live state backwards.
4. Filter noise: zero coordinates, impossible jumps, poor accuracy.
5. Accumulate distance, odometer, engine hours.
6. Trips: motion state machine writes Trips and DailyStats.
7. Events: geofence enter/exit, overspeed, alarms, ignition.
8. Write Positions, DeviceState (only if newer), Events.
9. Archive positions and events to compressed S3 through Pipes and Firehose.
10. Keep notification delivery asynchronous, so a slow provider never delays tracking.

## 6. Scaling

| Layer          | Scales by                                       | Planned limit                                      |
| -------------- | ----------------------------------------------- | -------------------------------------------------- |
| Gateway        | ECS autoscaling on CPU and connections per task | Connections per task measured by load test         |
| IoT Core       | Automatic                                       | Connect/publish quotas raised before rollout       |
| SQS FIFO       | Automatic, ~30K positions/s in Mumbai           | Switch to Kinesis at ~5,000 cars                   |
| Lambda         | Automatic, one batch per car in parallel        | Account concurrency raised to 1,000+ before launch |
| DynamoDB       | On-demand                                       | Per-table maximum throughput caps; pre-warm        |
| AppSync Events | Automatic                                       | Batched broadcasts, per-group channels             |
| S3 + Athena    | No practical limit                              | Date partitions, Parquet                           |

## 7. Cost

See [cost-model.md](cost-model.md). Earlier rough figures are planning inputs only. Release requires
a measured regional estimate for idle, steady-state, reconnect burst, storage, and live fanout.

## 8. Security and tenancy

- Tenant id comes from the login token, never the request; every key is tenant-prefixed.
- Roles: admin, dispatcher, viewer. Current authorization is tenant-wide; group scoping is a launch decision.
- Only registered IMEIs accepted; unknown devices are rate-limited and queued for onboarding.
- MQTT trackers use per-device certificates; phones get a per-device token in a later app release.
- API throttling, Cognito authentication, private S3 origins, and one IAM role per Lambda are in the local infrastructure.
- Location data is personal data (India DPDP Act): per-tenant retention, deletion on request, audit log.

## 9. Reliability and monitoring

- Every step is safe to repeat; failures retry and then move to a dead-letter queue.
- A bad message blocks only its own car.
- Alarms: dead-letter queue not empty, backlog over 60 s, processing errors, gateway connection
  drops, queueing failures, DynamoDB throttles, API/AppSync 5xx, and a canary tracker going silent.

## 10. Repository layout

```
platform/
  apps/tracker-gateway/    Node.js TCP/UDP tracker gateway
  apps/dashboard-web/      Next.js static dashboard for Amplify
  apps/mobile/             Expo Android and iOS application
  packages/api-client/     shared browser/mobile API client
  apps/dashboard/          static dashboard with live map, replay and reports
  services/*               Lambda services: ingest, process, API, realtime auth, maintenance
  packages/domain/         shared message contracts
  packages/protocols/      (phase 1) decoders + sample frames from real trackers
  packages/geo/            distance and geofence primitives
  packages/fleet/          deterministic trip and event state machine
  packages/data/           tenant-scoped DynamoDB access
  infra/                   CDK application
  tools/device-simulator/  tracker simulator
  docs/                    this plan, ADRs, data model, cost model, AWS setup
```

## 11. Testing

- Protocol decoders tested against real frames ported from the legacy server's 381 protocol tests.
- Trip and event logic replayed over recorded drives.
- API contract tests; tenant isolation tests.
- End-to-end: simulator → dev stack → dashboard API.
- Load tests (phase 5) with the targets in section 1.

## 12. Roadmap

| Phase                  | Scope                                                                                 | Exit criteria                                      |
| ---------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0. Foundations         | Implemented locally: monorepo, CDK, cost guardrails, budget, ADRs, CI                 | Full local check passes                            |
| 1. Ingest backbone     | Implemented locally: gateway, protocols, FIFO queue, processing, tables, simulator    | Production reconnect/load test remains             |
| 2. Identity, API, map  | Implemented locally: Cognito, tenant API, AppSync, dashboard                          | Production viewer/load test remains                |
| 3. Fleet logic         | Trips, geofences, overspeed, alarms and offline implemented; delivery adapters remain | Real-drive and tracker command tests               |
| 4. Reports and history | Hot reports, replay and compressed S3 archive implemented                             | Athena normalization and one-year benchmark remain |
| 5. Scale hardening     | Load tests, autoscaling tuning, quotas, alarms, canary, security review               | All section 1 targets met                          |
| 6. Launch              | Data import, pilot fleet, tracker cutover to the new endpoint                         | Pilot fleet stable for two weeks                   |

## 13. Scope

**First release:** live map, replay, geofences, alerts (overspeed, geofence, ignition, SOS, power
cut, offline), trips/stops/summary reports, commands including engine cut-off, users/roles/groups,
device management, push and email notifications.

**Later:** drivers and RFID, maintenance, fuel sensors, calendars, computed attributes, video,
single sign-on, share links, and the long tail of protocols.

## 14. Risks

| Risk                          | Mitigation                                                           |
| ----------------------------- | -------------------------------------------------------------------- |
| Tracker protocol quirks       | Real-device tests in phase 1; sample frames from the legacy tests    |
| Tracker cannot re-resolve DNS | NLB switch (+~$20/month idle)                                        |
| Wrong DynamoDB keys           | Access-pattern sign-off before coding; Athena for anything ad hoc    |
| Runaway bill                  | Guardrail aspect, throughput caps, concurrency limits, budget alerts |
| Ordering or duplicate bugs    | FIFO per car, idempotent writes, replay tests                        |
| Live-update cost at scale     | 1–2 s batching, changed cars only, per-group channels                |
| AWS lock-in                   | Domain logic in `packages/`, AWS wiring in thin adapters             |

## 15. Decisions taken

TypeScript everywhere · AWS CDK · AppSync Events · Mumbai · separate dev and prod accounts · SMS
alerts later · first protocols GT06 and Teltonika plus the phone app · code lives in `platform/`
inside the existing repository.
