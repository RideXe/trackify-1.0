import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { CorsHttpMethod, HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpJwtAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';
import type { DataStack } from './data-stack';
import type { IdentityStack } from './identity-stack';

export interface ApiStackProps extends StackProps {
  config: EnvConfig;
  data: DataStack;
  identity: IdentityStack;
  platformPath: string;
  dashboardUrl?: string;
}

export class ApiStack extends Stack {
  readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const dashboardUrl = props.dashboardUrl ?? props.config.dashboardUrl;
    const browserOrigins =
      props.config.envName === 'dev'
        ? [...new Set([dashboardUrl, 'http://localhost:5173'])]
        : [dashboardUrl];
    const handler = new NodejsFunction(this, 'FleetApiHandler', {
      entry: `${props.platformPath}/services/api/src/handler.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(15),
      environment: {
        CORE_TABLE: props.data.core.tableName,
        DEVICE_STATE_TABLE: props.data.deviceState.tableName,
        POSITIONS_TABLE: props.data.positions.tableName,
        EVENTS_TABLE: props.data.events.tableName,
        TRIPS_TABLE: props.data.trips.tableName,
        DAILY_STATS_TABLE: props.data.dailyStats.tableName,
        COMMANDS_TABLE: props.data.commands.tableName,
      },
      logGroup: new LogGroup(this, 'FleetApiLogs', { retention: RetentionDays.ONE_WEEK }),
      bundling: { minify: true, sourceMap: true },
    });
    props.data.core.grantReadWriteData(handler);
    props.data.deviceState.grantReadData(handler);
    props.data.positions.grantReadData(handler);
    props.data.events.grantReadData(handler);
    props.data.trips.grantReadData(handler);
    props.data.dailyStats.grantReadData(handler);
    props.data.commands.grantReadWriteData(handler);
    const authorizer = new HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${props.identity.userPool.userPoolId}`,
      { jwtAudience: [props.identity.client.userPoolClientId] },
    );
    this.api = new HttpApi(this, 'FleetApi', {
      corsPreflight: {
        allowOrigins: browserOrigins,
        allowHeaders: ['authorization', 'content-type'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
      },
    });
    const integration = new HttpLambdaIntegration('FleetApiIntegration', handler);
    this.api.addRoutes({
      path: '/me',
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });
    for (const path of [
      '/devices/{deviceId}/events',
      '/devices/{deviceId}/trips',
      '/devices/{deviceId}/summary',
    ]) {
      this.api.addRoutes({ path, methods: [HttpMethod.GET], integration, authorizer });
    }
    this.api.addRoutes({
      path: '/devices/{deviceId}/commands',
      methods: [HttpMethod.POST],
      integration,
      authorizer,
    });
    this.api.addRoutes({
      path: '/devices',
      methods: [HttpMethod.GET, HttpMethod.POST],
      integration,
      authorizer,
    });
    this.api.addRoutes({
      path: '/devices/{deviceId}/positions',
      methods: [HttpMethod.GET],
      integration,
      authorizer,
    });
    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
  }
}
