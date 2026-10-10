# Data model and access patterns

**Status: implemented locally; production sizing and restore rehearsal remain launch gates.**

Rule: every read is a key lookup or a bounded range query. No table scans. Anything ad hoc or
long-range runs on Athena over the S3 archive.

All tables are DynamoDB on-demand (see [ADR 0003](adr/0003-dynamodb-data-model.md)), encrypted with
AWS-managed keys, with a per-table maximum throughput cap so a bug cannot run up a bill.

## Tables

### Core — configuration (small, read often, point-in-time recovery on)

| Item               | pk                  | sk                          | Notes                                                 |
| ------------------ | ------------------- | --------------------------- | ----------------------------------------------------- |
| Tenant             | `TENANT#<tenantId>` | `META`                      | name, plan, retention settings                        |
| User               | `TENANT#<tenantId>` | `USER#<userId>`             | email, role, group ids, Cognito subject               |
| Group              | `TENANT#<tenantId>` | `GROUP#<groupId>`           | fleet/branch grouping                                 |
| Device             | `TENANT#<tenantId>` | `DEVICE#<deviceId>`         | name, uniqueId (IMEI), protocol, group                |
| Geofence           | `TENANT#<tenantId>` | `GEOFENCE#<id>`             | name, circle or polygon `shape`                       |
| Alert rule         | `TENANT#<tenantId>` | `RULE#<ruleId>`             | event types, targets, channels, hours                 |
| Calendar           | `TENANT#<tenantId>` | `CALENDAR#<id>`             | time zone and weekly windows                          |
| Push token         | `TENANT#<tenantId>` | `PUSH#<userId>#<id>`        | FCM registration of a phone or browser                |
| Scheduled report   | `TENANT#<tenantId>` | `REPORT#<id>`               | kind, schedule, scope; `dueKey`/`dueAt` while enabled |
| Computed attribute | `TENANT#<tenantId>` | `COMPUTED#<id>`             | target attribute, expression, order, scope            |
| Maintenance        | `TENANT#<tenantId>` | `MAINT#<id>`                | odometer, engine-hours or time interval               |
| Audit entry        | `TENANT#<tenantId>` | `AUDIT#<ulid>`              | who changed what; 1-year TTL                          |
| Announcement       | `TENANT#<tenantId>` | `ANNOUNCE#<ulid>`           | message to all users; TTL at expiry                   |
| Share link         | `SHARE#<tokenHash>` | `SHARE`                     | public live-location link; TTL at expiry              |
| Share listing      | `TENANT#<tenantId>` | `SHARELINK#<deviceId>#<id>` | a vehicle's active links                              |

Core has a TTL on `expiresAt`, set only on the short-lived items above.

Geofences are capped at 100 per tenant and 100 points per polygon: processing reads all of a
tenant's geofences in one query (AP-15) on every position, which must stay within one 1 MB page.

Group access: a vehicle has one `groupId` (`UNGROUPED` when none). A dispatcher or viewer whose
user record lists group ids sees only those groups' vehicles, and everything tied to them (history,
reports, alerts, commands); an empty list or the admin role means the whole fleet. Deleting a group
moves its vehicles to `UNGROUPED` and removes it from users.

- **GSI `byCognitoSub`** — pk `COGNITO#<sub>`, sk `TENANT#<tenantId>`: which tenant a signed-in user belongs to.
- **GSI `byUniqueId`** — pk `UNIQUEID#<uniqueId>`, sk `DEVICE`: the gateway's IMEI lookup; uniqueId is globally unique.
- **GSI `byDueTime`** (sparse, keys only) — pk `REPORT`, sk `<dueAt>`: scheduled reports that are due, across tenants.

### DeviceState — one item per car, the live view (DynamoDB Streams on)

`pk = <deviceId>`. Holds last position, `status` (online/offline), `lastSeenAt`, motion and trip
state, `geofencesInside`, odometer, engine hours, `tenantId`, `groupId`.

- **GSI `byTenant`** — pk `<tenantId>`, sk `<deviceId>`: the fleet list and live map bootstrap.
- **GSI `byStaleness`** (sparse, only while online) — pk `ONLINE`, sk `<lastSeenAt>`: the global
  one-minute sweep reads only cars that have gone quiet, marks at most 1,000 per invocation, and
  removes them from the sparse index atomically with the offline event.

### Positions — history, 90-day TTL

`pk = <deviceId>`, `sk = <fixTime>` (epoch ms, zero-padded). One item per fix, ~300 bytes.
No secondary index: every index would double write cost.

### Events — 1-year TTL

`pk = <deviceId>`, `sk = <eventTime>#<eventId>`.

- **GSI `byTenantMonth`** — pk `<tenantId>#<yyyy-mm>`, sk `<eventTime>#<eventId>`: tenant-wide event feed.

### Trips and DailyStats — computed during ingest, 2-year TTL

- Trips: `pk = <deviceId>`, `sk = <startTime>` — end time, distance, duration, max/avg speed, idle time, start/end points.
- DailyStats: `pk = <deviceId>`, `sk = <yyyy-mm-dd>` — distance, moving time, idle time, max speed, trip count, engine hours.

These make trips and summary reports O(days) instead of O(positions).

### Commands — 30-day TTL

`pk = <deviceId>`, `sk = <createdAt>#<commandId>` — type, payload, `status`
(`pending` → `sent` → `delivered` | `failed`), requested by, result.

### GatewaySessions — routing for commands

`pk = <deviceId>` — gateway task id, private IP, protocol, connected at, TTL refreshed by heartbeat.

### S3 archive

Positions and events flow from DynamoDB Streams through EventBridge Pipes and Firehose into a
private gzip-compressed S3 bucket partitioned by year/month/day/hour. This first archive format
preserves the DynamoDB stream envelope. A Glue/Athena normalization job and Parquet compaction must
be benchmarked before long-range production reporting is enabled.

## Read patterns

| ID    | Need                                                                                | Table / index               | Key condition                                                         |
| ----- | ----------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| AP-01 | Gateway resolves IMEI at connect                                                    | Core / `byUniqueId`         | pk = `UNIQUEID#<imei>`                                                |
| AP-02 | Pending commands when a car connects                                                | Commands                    | pk = tenant + device, bounded status filter                           |
| AP-03 | Live fleet list for the map                                                         | DeviceState / `byTenant`    | pk = tenantId (paged)                                                 |
| AP-04 | One car's live state                                                                | DeviceState                 | pk = deviceId                                                         |
| AP-05 | Route / replay for a time range                                                     | Positions                   | pk = deviceId, sk between from..to                                    |
| AP-06 | Latest N positions (map tail)                                                       | Positions                   | pk = deviceId, sk desc, limit N                                       |
| AP-07 | Events for one car                                                                  | Events                      | pk = deviceId, sk between from..to                                    |
| AP-08 | Tenant event feed                                                                   | Events / `byTenantMonth`    | pk = `<tenantId>#<yyyy-mm>`, sk range                                 |
| AP-09 | Trips / stops report                                                                | Trips                       | pk = deviceId, sk between from..to                                    |
| AP-10 | Summary report (up to ~1 year)                                                      | DailyStats                  | pk = deviceId, sk between dates                                       |
| AP-11 | Fleet-wide or multi-year report                                                     | Athena                      | partition `dt` between dates, tenant filter                           |
| AP-12 | Offline sweep every minute                                                          | DeviceState / `byStaleness` | pk = `ONLINE`, sk < now − timeout                                     |
| AP-13 | Sign-in: which tenant is this user                                                  | Core / `byCognitoSub`       | pk = `COGNITO#<sub>`                                                  |
| AP-14 | Devices, groups, geofences, rules list                                              | Core                        | pk = `TENANT#<id>`, sk begins_with `DEVICE#` etc.                     |
| AP-15 | Geofences, computed attributes, maintenance for processing (cached 60 s per tenant) | Core                        | pk = `TENANT#<id>`, sk begins_with `GEOFENCE#`, `COMPUTED#`, `MAINT#` |
| AP-16 | Which gateway holds a car                                                           | GatewaySessions             | pk = deviceId                                                         |
| AP-17 | Alert rules for a new event (cached 60 s)                                           | Core                        | pk = `TENANT#<id>`, sk begins_with `RULE#`                            |
| AP-18 | Scheduled reports that are due                                                      | Core / `byDueTime`          | pk = `REPORT`, sk <= now                                              |
| AP-19 | Commands waiting for connected devices                                              | Commands / `byStatus`       | pk = `PENDING`, sk > now (not expired)                                |
| AP-20 | Fleet-wide events in a period                                                       | Events / `byTenantMonth`    | pk = `<tenant>#<yyyy-mm>` per month, sk range                         |
| AP-21 | Resolve a public share link                                                         | Core                        | pk = `SHARE#<tokenHash>`                                              |

## Write patterns and invariants

| ID   | Write                | Rule                                                                                                       |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| W-01 | Position             | `PutItem` with `attribute_not_exists(pk) AND attribute_not_exists(sk)` — a retried message is ignored      |
| W-02 | DeviceState          | `UpdateItem` with `attribute_not_exists(fixTime) OR fixTime < :fixTime` — late data never moves state back |
| W-03 | Event                | Deterministic `eventId` (hash of device + type + time) so retries do not duplicate events                  |
| W-04 | DailyStats and Trips | Counters guarded by `lastFixTime < :fixTime`, so a retry cannot double-count distance                      |
| W-05 | Command status       | Conditional on the current status, so a late acknowledgement cannot revive a failed command                |
| W-06 | GatewaySession       | Written on connect with the task id; deleted on disconnect only if the task id still matches               |

## Size and cost estimates

At 1,000 cars sending ~1,000 positions a day: ~30M positions/month, ~15 GB/month.
With the 90-day TTL, Positions holds ~45 GB. Writes dominate cost, which is why events, trips and
daily stats are computed once during ingest rather than recomputed on read.

## Launch decisions still required

1. Is 90 days of hot positions right, or should it be tenant-configurable from the start?
2. Is a single-region deployment acceptable for launch (backups only, no cross-region replica)?
