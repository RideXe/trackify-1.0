import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { createPreSignUpHandler } from '../src/pre-signup';

const event = (extra: Partial<PreSignUpTriggerEvent> = {}, email = 'Asha@Example.com') =>
  ({
    triggerSource: 'PreSignUp_ExternalProvider',
    userPoolId: 'pool',
    userName: 'Microsoft_abc_123',
    request: { userAttributes: { email } },
    response: {},
    ...extra,
  }) as unknown as PreSignUpTriggerEvent;

describe('single sign-on', () => {
  it('links a provider identity to the invited account with the same email', async () => {
    const accounts = {
      invitedAccount: vi.fn().mockResolvedValue('sub-asha'),
      link: vi.fn().mockResolvedValue(undefined),
    };
    await createPreSignUpHandler(accounts)(event());
    expect(accounts.invitedAccount).toHaveBeenCalledWith('pool', 'asha@example.com');
    expect(accounts.link).toHaveBeenCalledWith('pool', 'sub-asha', 'Microsoft', 'abc_123');
  });

  it('turns away people who were not invited, or whose provider hides the email', async () => {
    const accounts = { invitedAccount: vi.fn().mockResolvedValue(undefined), link: vi.fn() };
    await expect(createPreSignUpHandler(accounts)(event())).rejects.toThrow(/invite/);
    await expect(createPreSignUpHandler(accounts)(event({}, ''))).rejects.toThrow(/email/);
    expect(accounts.link).not.toHaveBeenCalled();
  });

  it('leaves invitations by administrators alone', async () => {
    const accounts = { invitedAccount: vi.fn(), link: vi.fn() };
    const admin = event({ triggerSource: 'PreSignUp_AdminCreateUser' });
    expect(await createPreSignUpHandler(accounts)(admin)).toBe(admin);
    expect(accounts.invitedAccount).not.toHaveBeenCalled();
  });
});
