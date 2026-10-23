import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import {
  Architecture,
  FilterCriteria,
  FilterRule,
  Runtime,
  StartingPosition,
} from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource, SqsDlq } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { EmailIdentity, Identity } from 'aws-cdk-lib/aws-ses';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { LambdaSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue, QueueEncryption } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { acknowledgeCost } from '../aspects/cost-guardrails';
import type { EnvConfig } from '../config';
import { allowGeocoding } from '../constructs/geocoding';
import type { DataStack } from './data-stack';
import type { RealtimeStack } from './realtime-stack';

export interface NotificationStackProps extends StackProps {
  config: EnvConfig;
  data: DataStack;
  realtime?: RealtimeStack;
  platformPath: string;
}

/**
 * Alert delivery, off the tracking path: reads new events from the Events stream, so a slow email
 * or push provider can never delay positions.
 */
export class NotificationStack extends Stack {
  /** The API publishes new announcements here; the announcer delivers them. */
  readonly announcementsTopic: Topic;

  constructor(scope: Construct, id: string, props: NotificationStackProps) {
    super(scope, id, props);
    const { config, data } = props;

    // Fill in through the console: {"fcm": {...}, "telegram": {...}, "whatsapp": {...},
    // "pushover": {...}}. Generated once, so later deploys never overwrite what was entered.
    const credentials = new Secret(this, 'ChannelCredentials', {
      description: 'Trackify notification channel credentials (FCM, Telegram, WhatsApp, Pushover)',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'placeholder',
      },
    });
    // Deliberate: CloudFormation cannot create SSM SecureString parameters, and these are secrets.
    acknowledgeCost(credentials, 'one secret for all channel credentials, about $0.40 a month');
    // AWS emails a verification link to the sender; nothing is sent until it is clicked.
    const sender = config.emailSender
      ? new EmailIdentity(this, 'EmailSender', { identity: Identity.email(config.emailSender) })
      : undefined;

    const deadLetters = new Queue(this, 'NotifyDeadLetter', {
      retentionPeriod: Duration.days(14),
      encryption: QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    const notify = new NodejsFunction(this, 'Notify', {
      entry: `${props.platformPath}/services/notify/src/handler.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(60),
      environment: {
        CORE_TABLE: data.core.tableName,
        EVENTS_TABLE: data.events.tableName,
        POSITIONS_TABLE: data.positions.tableName,
        DEVICE_STATE_TABLE: data.deviceState.tableName,
        COMMANDS_TABLE: data.commands.tableName,
        CHANNEL_SECRET_ID: credentials.secretArn,
        EMAIL_SENDER: config.emailSender ?? '',
        DASHBOARD_URL: config.dashboardUrl,
        ...(props.realtime ? { REALTIME_HTTP_DNS: props.realtime.api.httpDns } : {}),
      },
      logGroup: new LogGroup(this, 'NotifyLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { minify: true, sourceMap: true },
    });
    notify.addEventSource(
      new DynamoEventSource(data.events, {
        startingPosition: StartingPosition.LATEST,
        batchSize: 50,
        maxBatchingWindow: Duration.seconds(1),
        reportBatchItemFailures: true,
        retryAttempts: 10,
        maxRecordAge: Duration.hours(1),
        onFailure: new SqsDlq(deadLetters),
        filters: [FilterCriteria.filter({ eventName: FilterRule.isEqual('INSERT') as unknown })],
      }),
    );

    data.core.grantReadWriteData(notify);
    data.events.grantReadData(notify);
    data.positions.grantReadData(notify);
    data.commands.grantWriteData(notify);
    allowGeocoding(notify, config);
    const canDeliver = (fn: NodejsFunction) => {
      credentials.grantRead(fn);
      props.realtime?.api.grantPublish(fn);
      sender?.grantSendEmail(fn);
      // SMS goes straight to phone numbers, which have no ARN: allow publishing to anything that
      // is not a topic, rather than every topic in the account.
      fn.addToRolePolicy(
        new PolicyStatement({ actions: ['sns:Publish'], notResources: ['arn:aws:sns:*:*:*'] }),
      );
    };
    canDeliver(notify);

    this.announcementsTopic = new Topic(this, 'Announcements', {
      displayName: 'Trackify announcements',
      enforceSSL: true,
    });
    const announcer = new NodejsFunction(this, 'Announcer', {
      entry: `${props.platformPath}/services/notify/src/announcements.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.minutes(2),
      environment: {
        CORE_TABLE: data.core.tableName,
        CHANNEL_SECRET_ID: credentials.secretArn,
        EMAIL_SENDER: config.emailSender ?? '',
        ...(props.realtime ? { REALTIME_HTTP_DNS: props.realtime.api.httpDns } : {}),
      },
      logGroup: new LogGroup(this, 'AnnouncerLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { minify: true, sourceMap: true },
    });
    data.core.grantReadWriteData(announcer);
    canDeliver(announcer);
    this.announcementsTopic.addSubscription(new LambdaSubscription(announcer));

    // Scheduled reports: due ones are read from a sparse index, so a quarter-hourly check is cheap.
    const reports = new NodejsFunction(this, 'ScheduledReports', {
      entry: `${props.platformPath}/services/notify/src/scheduled-reports.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.minutes(5),
      environment: {
        CORE_TABLE: data.core.tableName,
        DEVICE_STATE_TABLE: data.deviceState.tableName,
        POSITIONS_TABLE: data.positions.tableName,
        EVENTS_TABLE: data.events.tableName,
        TRIPS_TABLE: data.trips.tableName,
        DAILY_STATS_TABLE: data.dailyStats.tableName,
        EMAIL_SENDER: config.emailSender ?? '',
      },
      logGroup: new LogGroup(this, 'ScheduledReportsLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { minify: true, sourceMap: true },
    });
    data.core.grantReadWriteData(reports);
    data.deviceState.grantReadData(reports);
    for (const table of [data.positions, data.events, data.trips, data.dailyStats])
      table.grantReadData(reports);
    sender?.grantSendEmail(reports);
    new Rule(this, 'ScheduledReportsSchedule', {
      schedule: Schedule.rate(Duration.minutes(15)),
      targets: [new LambdaFunction(reports, { retryAttempts: 0 })],
    });

    new CfnOutput(this, 'ChannelCredentialsSecret', { value: credentials.secretName });
  }
}
