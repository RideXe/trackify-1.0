import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, it } from 'vitest';
import { loadConfig } from '../lib/config';
import { IdentityStack } from '../lib/stacks/identity-stack';

const context = { env: 'dev', account: '123456789012', alertEmail: 'alerts@example.com' };

describe('IdentityStack', () => {
  it('creates a private user pool and public PKCE-compatible app client', () => {
    const app = new App();
    const config = loadConfig((key) => context[key as keyof typeof context]);
    const template = Template.fromStack(new IdentityStack(app, 'Identity', { config }));
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      AutoVerifiedAttributes: ['email'],
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
    });
  });
});
