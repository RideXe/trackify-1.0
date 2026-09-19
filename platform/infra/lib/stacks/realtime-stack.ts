import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { AppSyncAuthorizationType, EventApi, LambdaInvokeType } from 'aws-cdk-lib/aws-appsync';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';
import type { DataStack } from './data-stack';
import type { IdentityStack } from './identity-stack';

export interface RealtimeStackProps extends StackProps {
  config: EnvConfig;
  data: DataStack;
  identity: IdentityStack;
  platformPath: string;
}

export class RealtimeStack extends Stack {
  readonly api: EventApi;

  constructor(scope: Construct, id: string, props: RealtimeStackProps) {
    super(scope, id, props);
    const auth = new NodejsFunction(this, 'SubscriptionAuthorization', {
      entry: `${props.platformPath}/services/realtime-auth/src/handler.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 128,
      timeout: Duration.seconds(5),
      environment: { CORE_TABLE: props.data.core.tableName },
      logGroup: new LogGroup(this, 'SubscriptionAuthorizationLogs', {
        retention: RetentionDays.ONE_WEEK,
      }),
      bundling: { minify: true, sourceMap: true },
    });
    props.data.core.grantReadData(auth);
    this.api = new EventApi(this, 'LiveFleet', {
      apiName: `trackify-${props.config.envName}-live`,
      authorizationConfig: {
        authProviders: [
          { authorizationType: AppSyncAuthorizationType.IAM },
          {
            authorizationType: AppSyncAuthorizationType.USER_POOL,
            cognitoConfig: { userPool: props.identity.userPool },
          },
        ],
        connectionAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
        defaultPublishAuthModeTypes: [AppSyncAuthorizationType.IAM],
        defaultSubscribeAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
      },
    });
    const dataSource = this.api.addLambdaDataSource('SubscriptionMembership', auth);
    this.api.addChannelNamespace('FleetNamespace', {
      channelNamespaceName: 'fleet',
      subscribeHandlerConfig: {
        direct: true,
        dataSource,
        lambdaInvokeType: LambdaInvokeType.REQUEST_RESPONSE,
      },
      authorizationConfig: {
        publishAuthModeTypes: [AppSyncAuthorizationType.IAM],
        subscribeAuthModeTypes: [AppSyncAuthorizationType.USER_POOL],
      },
    });
    new CfnOutput(this, 'RealtimeHttpDns', { value: this.api.httpDns });
    new CfnOutput(this, 'RealtimeWebSocketDns', { value: this.api.realtimeDns });
  }
}
