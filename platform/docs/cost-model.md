# Cost model

Status: planning model, not a quotation or measured production bill. Earlier fleet-wide
estimates are withdrawn until request amplification and regional prices are measured.
Use Mumbai prices and account-wide free-tier usage before deployment; credits are temporary.

## Idle behavior

An empty serverless application can have almost no compute charges. Retained data, backups,
images, DNS, logs, queue polling, and monitoring can still cost money. No viewers is not zero
load: parked vehicles may send heartbeats and MQTT connections incur connection charges.

Raw TCP/UDP trackers require a running gateway. Budget its requested CPU and memory for every
running hour, plus public IPv4, DNS, images, and logs. A 0.25-vCPU/0.5-GB ARM task is a candidate
for testing, not a verified memory budget. For highly available TCP service include an NLB,
its capacity usage and addresses, and at least two gateway tasks. DNS-only mode is a pilot
trade-off and must not be advertised as equivalent availability.

## Workload calculation

For N vehicles at interval S seconds, average positions/second = N / S.
At 10,000 continuously reporting vehicles and 30 seconds, this is about 333 positions/second
and 864 million positions per 30-day month. At 100,000 it is about 3,333/second.
Model reconnect bursts and buffered uploads separately from this average.

For each position count queue send/receive/delete requests, retries, Lambda duration,
base-table writes, index writes, transactional write multipliers, archive ingestion, and
notifications. Live delivery also multiplies by authorized subscribers; batching reduces
operations but not payload bytes. Include map tiles, geocoding, SMS, and email separately.

Storage estimate = positions/day × retained days × measured item bytes, plus indexes and
backups. For 1,000 vehicles × 1,000 fixes/day × 90 days × 500 bytes, raw payload alone is
45 GB (decimal), excluding key names and other overhead.

## Release evidence

Record costs per million accepted positions, per million live deliveries, and per retained GB
from a measured test. Capture effective request sizes, retry rate, batch fill, viewers, and
regional rates. Compare an empty 24-hour run, a steady fleet, and a reconnect burst.

Do not switch to Kinesis at an arbitrary car count: compare throughput, replay needs, and
measured total cost. Provisioned DynamoDB introduces an idle baseline and is not always cheaper.
Budget alerts do not stop charges. Concurrency and throughput caps can cause delays and must be
paired with queue-age alerts, retention margins, and recovery capacity.

Sources to recheck for the deployment region:

- [Fargate](https://aws.amazon.com/fargate/pricing/)
- [SQS](https://aws.amazon.com/sqs/pricing/)
- [DynamoDB](https://aws.amazon.com/dynamodb/pricing/)
- [AppSync](https://aws.amazon.com/appsync/pricing/)
- [Lambda](https://aws.amazon.com/lambda/pricing/)
