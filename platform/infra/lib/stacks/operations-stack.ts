import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';
import type { DataStack } from './data-stack';

export interface OperationsStackProps extends StackProps {
  config: EnvConfig;
  data: DataStack;
  platformPath: string;
}

/** Low-frequency maintenance that scales to zero between invocations. */
export class OperationsStack extends Stack {
  constructor(scope: Construct, id: string, props: OperationsStackProps) {
    super(scope, id, props);

    const logGroup = new LogGroup(this, 'OfflineSweepLogs', {
      retention: RetentionDays.ONE_WEEK,
    });
    const sweep = new NodejsFunction(this, 'OfflineSweep', {
      entry: `${props.platformPath}/services/offline/src/handler.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.minutes(1),
      environment: {
        DEVICE_STATE_TABLE: props.data.deviceState.tableName,
        EVENTS_TABLE: props.data.events.tableName,
        COMMANDS_TABLE: props.data.commands.tableName,
        OFFLINE_AFTER_MS: '300000',
      },
      logGroup,
      bundling: { minify: true, sourceMap: true },
    });
    props.data.deviceState.grantReadWriteData(sweep);
    props.data.events.grantWriteData(sweep);
    props.data.commands.grantReadWriteData(sweep);

    new Rule(this, 'OfflineSweepSchedule', {
      schedule: Schedule.rate(Duration.minutes(1)),
      targets: [new LambdaFunction(sweep, { retryAttempts: 2 })],
    });
  }
}
