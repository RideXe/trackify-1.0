import { Stack, type StackProps } from 'aws-cdk-lib';
import { BucketDeployment, Source } from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import type { ApiStack } from './api-stack';
import type { HostingStack } from './hosting-stack';
import type { IdentityStack } from './identity-stack';
import type { RealtimeStack } from './realtime-stack';

export interface DashboardAssetsStackProps extends StackProps {
  hosting: HostingStack;
  identity: IdentityStack;
  api: ApiStack;
  realtime: RealtimeStack;
  platformPath: string;
}

export class DashboardAssetsStack extends Stack {
  constructor(scope: Construct, id: string, props: DashboardAssetsStackProps) {
    super(scope, id, props);
    const config = [
      'window.TRACKIFY_CONFIG = {',
      `  apiUrl: ${JSON.stringify(props.api.api.apiEndpoint)},`,
      `  cognitoDomain: ${JSON.stringify(props.identity.domainName)},`,
      `  clientId: ${JSON.stringify(props.identity.client.userPoolClientId)},`,
      `  realtimeDns: ${JSON.stringify(props.realtime.api.realtimeDns)},`,
      `  redirectUri: ${JSON.stringify(props.hosting.dashboardUrl)},`,
      '};',
    ].join('\n');
    new BucketDeployment(this, 'DashboardDeployment', {
      destinationBucket: props.hosting.bucket,
      sources: [
        Source.asset(`${props.platformPath}/apps/dashboard`, {
          exclude: ['config.js', 'package.json'],
        }),
        Source.data('config.js', config),
      ],
      distribution: props.hosting.distribution,
      distributionPaths: ['/*'],
      prune: true,
    });
  }
}
