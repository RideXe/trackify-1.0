import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Architecture, FunctionUrlAuthType, Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';
import type { DataStack } from './data-stack';
import type { RealtimeStack } from './realtime-stack';

export interface IngestStackProps extends StackProps {
  config: EnvConfig;
  data: DataStack;
  platformPath: string;
  realtime?: RealtimeStack;
}

export class IngestStack extends Stack {
  readonly queue: Queue;
  readonly deadLetterQueue: Queue;

  constructor(scope: Construct, id: string, props: IngestStackProps) {
    super(scope, id, props);
    this.deadLetterQueue = new Queue(this, 'IngestDeadLetter', {
      fifo: true,
      retentionPeriod: Duration.days(14),
    });
    this.queue = new Queue(this, 'IngestQueue', {
      fifo: true,
      contentBasedDeduplication: false,
      visibilityTimeout: Duration.minutes(2),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 5 },
    });

    const processor = nodeFunction(
      this,
      'ProcessPositions',
      `${props.platformPath}/services/process/src/handler.ts`,
      {
        POSITIONS_TABLE: props.data.positions.tableName,
        DEVICE_STATE_TABLE: props.data.deviceState.tableName,
        CORE_TABLE: props.data.core.tableName,
        EVENTS_TABLE: props.data.events.tableName,
        TRIPS_TABLE: props.data.trips.tableName,
        DAILY_STATS_TABLE: props.data.dailyStats.tableName,
        ...(props.realtime ? { REALTIME_HTTP_DNS: props.realtime.api.httpDns } : {}),
      },
    );
    processor.addEventSource(
      new SqsEventSource(this.queue, {
        batchSize: 10,
        reportBatchItemFailures: true,
        maxConcurrency: 100,
      }),
    );
    this.queue.grantConsumeMessages(processor);
    props.data.positions.grantWriteData(processor);
    props.data.deviceState.grantWriteData(processor);
    props.data.core.grantReadData(processor);
    props.data.events.grantWriteData(processor);
    props.data.trips.grantWriteData(processor);
    props.data.dailyStats.grantWriteData(processor);
    props.realtime?.api.grantPublish(processor);

    if (props.config.allowLegacyPhoneIngest) {
      const phone = nodeFunction(
        this,
        'PhoneIngest',
        `${props.platformPath}/services/ingest-http/src/handler.ts`,
        {
          CORE_TABLE: props.data.core.tableName,
          INGEST_QUEUE_URL: this.queue.queueUrl,
        },
      );
      props.data.core.grantReadData(phone);
      this.queue.grantSendMessages(phone);
      phone.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });
    }
  }
}

function nodeFunction(
  scope: Construct,
  id: string,
  entry: string,
  environment: Record<string, string>,
) {
  const logGroup = new LogGroup(scope, `${id}Logs`, { retention: RetentionDays.ONE_WEEK });
  return new NodejsFunction(scope, id, {
    entry,
    runtime: Runtime.NODEJS_24_X,
    architecture: Architecture.ARM_64,
    memorySize: 256,
    timeout: Duration.seconds(15),
    environment,
    logGroup,
    bundling: { minify: true, sourceMap: true },
  });
}
