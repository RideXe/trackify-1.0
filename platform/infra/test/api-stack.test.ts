import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { ApiStack } from '../lib/stacks/api-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { IdentityStack } from '../lib/stacks/identity-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

let synthesized: Template | undefined;

/** Bundling five Lambdas takes seconds, so every test reads one synthesized template. */
function synthesize() {
  if (synthesized) return synthesized;
  const app = new App();
  const config = loadConfig((key) => context[key as keyof typeof context]);
  const stack = new ApiStack(app, 'Api', {
    config,
    data: new DataStack(app, 'Data', { config }),
    identity: new IdentityStack(app, 'Identity', { config }),
    platformPath: new URL('../..', import.meta.url).pathname,
    ingestQueue: new Queue(new Stack(app, 'QueueStack'), 'IngestQueue'),
  });
  synthesized = Template.fromStack(stack);
  return synthesized;
}

describe('ApiStack', () => {
  it('protects fleet routes with a Cognito JWT authorizer', () => {
    const template = synthesize();
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'JWT',
      IdentitySource: ['$request.header.Authorization'],
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: {
        AllowOrigins: ['http://localhost:5173'],
      },
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: Match.stringLikeRegexp('GET /devices'),
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'PATCH /devices/{deviceId}',
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      AuthorizationType: 'JWT',
      RouteKey: 'DELETE /devices/{deviceId}',
    });
    for (const routeKey of [
      'GET /drivers',
      'POST /drivers',
      'PATCH /drivers/{driverId}',
      'DELETE /drivers/{driverId}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        AuthorizationType: 'JWT',
        RouteKey: routeKey,
      });
    }
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: { AllowMethods: Match.arrayWith(['PATCH', 'DELETE']) },
    });
    for (const routeKey of [
      'GET /organisation',
      'PATCH /organisation',
      'GET /alerts',
      'GET /trips',
      'PATCH /alerts/{alertId}',
      'GET /devices/{deviceId}/activity',
      'POST /devices/{deviceId}/messages',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        AuthorizationType: 'JWT',
        RouteKey: routeKey,
      });
    }
  });

  it('serves the driver app with device credentials, private photos and alert email', () => {
    const template = synthesize();
    for (const routeKey of [
      'GET /phone/config',
      'POST /phone/activity',
      'GET /phone/messages',
      'POST /phone/photos',
      'GET /phone/today',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        AuthorizationType: 'NONE',
        RouteKey: routeKey,
      });
    }
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
    });
    template.hasResourceProperties('AWS::SNS::Subscription', {
      Protocol: 'email',
      Endpoint: 'alerts@example.com',
    });
  });
});
