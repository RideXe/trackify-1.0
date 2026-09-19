# ADR 0002: SQS FIFO ingestion

Use FIFO message groups keyed by tenant and device. Different groups process concurrently;
within one group processing follows enqueue order, not GPS event time. Late and offline-buffered
records require event-time reconciliation. Consumers remain idempotent beyond the queue's
deduplication window. After a failure within a group, return unprocessed records for retry rather
than silently advancing dependent state.

A protocol acknowledgement is sent after durable acceptance where the protocol permits.
Lost acknowledgements and finite device buffers prevent an unconditional zero-loss guarantee.
IoT rule delivery failures require an error destination and alarms.

Kinesis is a future alternative requiring migration, replay, and ordering tests, not a working
flag-only replacement. Revisit based on measured workload, not vehicle count alone.

[Ordering documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/fifo-queue-lambda-behavior.html)
