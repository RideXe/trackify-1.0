import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnDeliveryStream } from 'aws-cdk-lib/aws-kinesisfirehose';
import { Effect, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnPipe } from 'aws-cdk-lib/aws-pipes';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';
import type { DataStack } from './data-stack';

export interface ArchiveStackProps extends StackProps {
  config: EnvConfig;
  data: DataStack;
}

/** Usage-priced cold archive fed directly from DynamoDB streams. */
export class ArchiveStack extends Stack {
  readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: ArchiveStackProps) {
    super(scope, id, props);
    const retain = props.config.envName === 'prod';
    this.bucket = new Bucket(this, 'Archive', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [
        { id: 'ExpireIncompleteUploads', abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      removalPolicy: retain ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !retain,
    });

    this.connectStream(
      'Positions',
      requiredStreamArn(props.data.positions.tableStreamArn, 'positions'),
      'positions',
    );
    this.connectStream(
      'Events',
      requiredStreamArn(props.data.events.tableStreamArn, 'events'),
      'events',
    );
  }

  private connectStream(id: string, sourceArn: string, prefix: string) {
    const firehoseRole = new Role(this, `${id}FirehoseRole`, {
      assumedBy: new ServicePrincipal('firehose.amazonaws.com'),
    });
    this.bucket.grantReadWrite(firehoseRole);
    const delivery = new CfnDeliveryStream(this, `${id}Delivery`, {
      deliveryStreamType: 'DirectPut',
      extendedS3DestinationConfiguration: {
        bucketArn: this.bucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        compressionFormat: 'GZIP',
        bufferingHints: { intervalInSeconds: 60, sizeInMBs: 1 },
        prefix: `${prefix}/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/hour=!{timestamp:HH}/`,
        errorOutputPrefix: `errors/${prefix}/!{firehose:error-output-type}/`,
      },
    });

    const pipeRole = new Role(this, `${id}PipeRole`, {
      assumedBy: new ServicePrincipal('pipes.amazonaws.com'),
    });
    pipeRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          'dynamodb:DescribeStream',
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:ListStreams',
        ],
        resources: [sourceArn],
      }),
    );
    pipeRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['firehose:PutRecord', 'firehose:PutRecordBatch'],
        resources: [delivery.attrArn],
      }),
    );
    new CfnPipe(this, `${id}ArchivePipe`, {
      roleArn: pipeRole.roleArn,
      source: sourceArn,
      sourceParameters: {
        dynamoDbStreamParameters: {
          batchSize: 100,
          maximumBatchingWindowInSeconds: 60,
          startingPosition: 'LATEST',
        },
      },
      target: delivery.attrArn,
    });
  }
}

function requiredStreamArn(value: string | undefined, table: string) {
  if (!value) throw new Error(`${table} stream is required for archival`);
  return value;
}
