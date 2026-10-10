import type { PreSignUpTriggerEvent } from 'aws-lambda';
import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';

export interface AccountDirectory {
  /** The invited (password) account with this email, if any. */
  invitedAccount(userPoolId: string, email: string): Promise<string | undefined>;
  link(
    userPoolId: string,
    username: string,
    provider: string,
    providerUserId: string,
  ): Promise<void>;
}

/**
 * Single sign-on is for invited users only: fleet membership comes from the invitation. The
 * first SSO sign-in links the provider identity to the invited account with the same email, so
 * both sign-in methods reach the same user and fleet; anyone not invited is turned away.
 */
export function createPreSignUpHandler(accounts: AccountDirectory) {
  return async (event: PreSignUpTriggerEvent) => {
    if (event.triggerSource !== 'PreSignUp_ExternalProvider') return event;
    const email = event.request.userAttributes.email?.trim().toLowerCase();
    if (!email) throw new Error('Your sign-in provider did not share an email address.');
    const username = await accounts.invitedAccount(event.userPoolId, email);
    if (!username)
      throw new Error('Ask your fleet administrator to invite this email address first.');
    // Federated usernames look like "Provider_subject"; the provider name may itself contain "_".
    const separator = event.userName.indexOf('_');
    const provider = event.userName.slice(0, separator);
    const providerUserId = event.userName.slice(separator + 1);
    await accounts.link(event.userPoolId, username, provider, providerUserId);
    return event;
  };
}

/** Matches only confirmed password accounts, so one SSO identity can never claim another. */
export class CognitoAccounts implements AccountDirectory {
  constructor(private readonly client: CognitoIdentityProviderClient) {}

  async invitedAccount(userPoolId: string, email: string) {
    const result = await this.client.send(
      new ListUsersCommand({
        UserPoolId: userPoolId,
        Filter: `email = "${email.replace(/["\\]/g, '')}"`,
        Limit: 10,
      }),
    );
    return result.Users?.find(
      (user) => user.UserStatus !== 'EXTERNAL_PROVIDER' && user.Enabled !== false,
    )?.Username;
  }

  async link(userPoolId: string, username: string, provider: string, providerUserId: string) {
    await this.client.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: userPoolId,
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: username },
        SourceUser: {
          ProviderName: provider,
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: providerUserId,
        },
      }),
    );
  }
}

export const handler = createPreSignUpHandler(
  new CognitoAccounts(new CognitoIdentityProviderClient({})),
);
