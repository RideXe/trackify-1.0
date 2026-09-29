import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoOnboardingStore } from '../src/onboarding-store';
describe('credential revocation', () => {
  it('does not authorize stale activated records returned by the index', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Count: 1, Items: [{ codeHash: 'hash', status: 'activated' }] })
      .mockResolvedValueOnce({ Item: { codeHash: 'hash', status: 'revoked' } });
    const store = new DynamoOnboardingStore(
      { send } as unknown as DynamoDBDocumentClient,
      'onboarding',
    );
    expect(await store.resolveCredential('credential-hash')).toBeUndefined();
    const command = send.mock.calls[1]?.[0] as { input: { ConsistentRead?: boolean } };
    expect(command.input.ConsistentRead).toBe(true);
  });
  it('treats concurrent or repeated redemptions as unavailable', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('used'), { name: 'ConditionalCheckFailedException' }),
      );
    const store = new DynamoOnboardingStore(
      { send } as unknown as DynamoDBDocumentClient,
      'onboarding',
    );
    expect(await store.redeem('code', 'credential', Date.now())).toBeUndefined();
  });
});
