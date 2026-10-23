import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
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
      ExplicitAuthFlows: [
        'ALLOW_USER_PASSWORD_AUTH',
        'ALLOW_USER_SRP_AUTH',
        'ALLOW_REFRESH_TOKEN_AUTH',
      ],
      AllowedOAuthFlows: ['code'],
      CallbackURLs: ['http://localhost:5173', 'trackify://auth/callback'],
      LogoutURLs: ['http://localhost:5173', 'trackify://auth/callback'],
    });
  });
});

describe('IdentityStack single sign-on', () => {
  it('adds providers with secrets from Secrets Manager and an invited-users-only linker', () => {
    const app = new App();
    const config = loadConfig(
      (key) =>
        ({
          env: 'dev',
          account: '123456789012',
          alertEmail: 'alerts@example.com',
          oidcName: 'Microsoft',
          oidcIssuerUrl: 'https://login.microsoftonline.com/tenant/v2.0',
          oidcClientId: 'client',
          oidcClientSecretName: 'trackify/sso/microsoft',
        })[key],
    );
    const template = Template.fromStack(
      new IdentityStack(app, 'Identity', {
        config,
        platformPath: new URL('../..', import.meta.url).pathname,
      }),
    );
    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      ProviderName: 'Microsoft',
      ProviderType: 'OIDC',
      ProviderDetails: Match.objectLike({
        client_secret: '{{resolve:secretsmanager:trackify/sso/microsoft:SecretString:::}}',
      }),
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      SupportedIdentityProviders: ['COGNITO', { Ref: Match.stringLikeRegexp('^OidcProvider') }],
    });
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PreSignUp: Match.anyValue() },
    });
  });

  it('is off by default', () => {
    const app = new App();
    const config = loadConfig(
      (key) => ({ env: 'dev', account: '123456789012', alertEmail: 'a@b.co' })[key],
    );
    const template = Template.fromStack(new IdentityStack(app, 'Identity', { config }));
    template.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 0);
  });
});
