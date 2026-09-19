import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { ApiStack } from '../lib/stacks/api-stack';
import { DataStack } from '../lib/stacks/data-stack';
import { IdentityStack } from '../lib/stacks/identity-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

describe('ApiStack', () => {
  it('protects fleet routes with a Cognito JWT authorizer', () => {
    const app = new App();
    const config = loadConfig((key) => context[key as keyof typeof context]);
    const data = new DataStack(app, 'Data', { config });
    const identity = new IdentityStack(app, 'Identity', { config });
    const stack = new ApiStack(app, 'Api', {
      config,
      data,
      identity,
      platformPath: new URL('../..', import.meta.url).pathname,
    });
    const template = Template.fromStack(stack);
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
  });
});
