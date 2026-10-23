import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import {
  AccountRecovery,
  Mfa,
  OAuthScope,
  ProviderAttribute,
  UserPool,
  type UserPoolClient,
  UserPoolClientIdentityProvider,
  UserPoolIdentityProviderGoogle,
  UserPoolIdentityProviderOidc,
  UserPoolOperation,
  type IUserPoolIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Architecture, Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export interface IdentityStackProps extends StackProps {
  config: EnvConfig;
  dashboardUrl?: string;
  /** Needed only when single sign-on is configured (for the account-linking trigger). */
  platformPath?: string;
}

export class IdentityStack extends Stack {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly domainName: string;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    const dashboardUrl = props.dashboardUrl ?? props.config.dashboardUrl;
    const browserUrls =
      props.config.envName === 'dev'
        ? [...new Set([dashboardUrl, 'http://localhost:5173', 'trackify://auth/callback'])]
        : [dashboardUrl];
    this.userPool = new UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      mfa: props.config.envName === 'prod' ? Mfa.OPTIONAL : Mfa.OFF,
      passwordPolicy: {
        minLength: 12,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
      },
      removalPolicy: props.config.envName === 'prod' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    const providers = this.singleSignOn(props);
    this.client = this.userPool.addClient('DashboardClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      supportedIdentityProviders: [
        UserPoolClientIdentityProvider.COGNITO,
        ...providers.map((provider) =>
          UserPoolClientIdentityProvider.custom(provider.providerName),
        ),
      ],
      authFlows: { userSrp: true, userPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: browserUrls,
        logoutUrls: browserUrls,
      },
    });
    for (const provider of providers) this.client.node.addDependency(provider);
    const domain = this.userPool.addDomain('ManagedLoginDomain', {
      cognitoDomain: { domainPrefix: props.config.cognitoDomainPrefix },
    });
    this.domainName = `${props.config.cognitoDomainPrefix}.auth.${this.region}.amazoncognito.com`;
    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.client.userPoolClientId });
    new CfnOutput(this, 'ManagedLoginUrl', {
      value: domain.signInUrl(this.client, { redirectUri: dashboardUrl }),
    });
  }

  /**
   * Federated sign-in. Secrets are resolved by CloudFormation from Secrets Manager at deploy time,
   * never written into the template. Invited users only: see services/api/src/pre-signup.ts.
   */
  private singleSignOn(props: IdentityStackProps): IUserPoolIdentityProvider[] {
    const { sso } = props.config;
    if (!sso.length) return [];
    const email = { email: ProviderAttribute.other('email') };
    const providers = sso.map((provider): IUserPoolIdentityProvider =>
      provider.kind === 'oidc'
        ? new UserPoolIdentityProviderOidc(this, 'OidcProvider', {
            userPool: this.userPool,
            name: provider.name.replace(/ /g, ''),
            issuerUrl: provider.issuerUrl,
            clientId: provider.clientId,
            clientSecret: SecretValue.secretsManager(provider.clientSecretName).unsafeUnwrap(),
            scopes: ['openid', 'email', 'profile'],
            attributeMapping: email,
          })
        : new UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
            userPool: this.userPool,
            clientId: provider.clientId,
            clientSecretValue: SecretValue.secretsManager(provider.clientSecretName),
            scopes: ['openid', 'email', 'profile'],
            attributeMapping: { email: ProviderAttribute.GOOGLE_EMAIL },
          }),
    );
    if (!props.platformPath) throw new Error('platformPath is required for single sign-on');
    const linker = new NodejsFunction(this, 'SsoAccountLinker', {
      entry: `${props.platformPath}/services/api/src/pre-signup.ts`,
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(5),
      logGroup: new LogGroup(this, 'SsoAccountLinkerLogs', { retention: RetentionDays.ONE_MONTH }),
      bundling: { minify: true, sourceMap: true },
    });
    // The pool's own ARN would make the pool and its trigger depend on each other.
    linker.addToRolePolicy(
      new PolicyStatement({
        actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'],
        resources: [`arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`],
      }),
    );
    this.userPool.addTrigger(UserPoolOperation.PRE_SIGN_UP, linker);
    return providers;
  }
}
