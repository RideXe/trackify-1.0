# ADR 0003: DynamoDB and archive

Use on-demand tables for request-driven storage and S3 for retained history. Start from explicit
access patterns and tenant-prefixed keys. Avoid hot tenant-wide partitions with bucket or shard
strategies validated under a large single-tenant fleet. ULIDs identify entities; source record
identity must distinguish different records sharing a fix timestamp.

Processing requires atomic state transitions and durable outbox work. A successful position
write followed by a crash must not suppress remaining state, archive, or notification work on
retry. TTL is eventual cleanup, not a precise deletion deadline. Query filters enforce expiry;
user-requested deletion needs explicit deletion and archive or backup policy.

The current schema and timestamp-based dedupe helper are prototypes, not complete ingestion
correctness. Review the access-pattern document before implementing storage.
