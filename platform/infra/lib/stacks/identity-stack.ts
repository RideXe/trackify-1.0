import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  AccountRecovery,
  Mfa,
  OAuthScope,
  UserPool,
  type UserPoolClient,
  UserPoolClientIdentityProvider,
} from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { EnvConfig } from '../config';

export interface IdentityStackProps extends StackProps {
  config: EnvConfig;
  dashboardUrl?: string;
}

export class IdentityStack extends Stack {
  readonly userPool: UserPool;
  readonly client: UserPoolClient;
  readonly domainName: string;

  constructor(scope: Construct, id: string, props: IdentityStackProps) {
    super(scope, id, props);
    const dashboardUrl = props.dashboardUrl ?? props.config.dashboardUrl;
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
    this.client = this.userPool.addClient('DashboardClient', {
      generateSecret: false,
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [OAuthScope.OPENID, OAuthScope.EMAIL, OAuthScope.PROFILE],
        callbackUrls: [dashboardUrl],
        logoutUrls: [dashboardUrl],
      },
    });
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
}
