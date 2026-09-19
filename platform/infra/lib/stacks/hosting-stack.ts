import { CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { BlockPublicAccess, Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export interface HostingStackProps extends StackProps {
  config: EnvConfig;
}

export class HostingStack extends Stack {
  readonly bucket: Bucket;
  readonly distribution: Distribution;
  readonly dashboardUrl: string;

  constructor(scope: Construct, id: string, props: HostingStackProps) {
    super(scope, id, props);
    this.bucket = new Bucket(this, 'DashboardFiles', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: props.config.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: props.config.envName !== 'prod',
    });
    this.distribution = new Distribution(this, 'DashboardCdn', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html' },
      ],
    });
    this.dashboardUrl = `https://${this.distribution.distributionDomainName}`;
    new CfnOutput(this, 'DashboardUrl', { value: this.dashboardUrl });
  }
}
