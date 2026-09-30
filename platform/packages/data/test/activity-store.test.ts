import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { decodeTime } from 'ulid';
import { DynamoActivityStore } from '../src/activity-store';

function storeWith(send: ReturnType<typeof vi.fn>) {
  return new DynamoActivityStore({ send } as unknown as DynamoDBDocumentClient, 'core');
}
const input = (send: ReturnType<typeof vi.fn>, call = 0) =>
  (send.mock.calls[call]?.[0] as { input: Record<string, unknown> }).input;

describe('driver activity log', () => {
  it('files entries under the vehicle, keyed by arrival time', async () => {
    const send = vi.fn().mockResolvedValue({});
    const entry = await storeWith(send).append(
      't',
      { deviceId: 'd', type: 'sos', at: 1_000 },
      1_800_000_000_000,
    );
    const item = input(send).Item as Record<string, unknown>;
    expect(item.pk).toBe('TENANT#t#DEVICE#d');
    expect(item.sk).toBe(`LOG#${entry.entryId}`);
    expect(decodeTime(entry.entryId)).toBe(1_800_000_000_000);
    expect(entry.at).toBe(1_000);
  });

  it('reads a time window newest first and strips storage keys', async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [{ pk: 'x', sk: 'y', tenantId: 't', entryId: 'e', type: 'message', text: 'hi' }],
    });
    const items = await storeWith(send).list('t', 'd', 0, 1_800_000_000_000, 50, 'message');
    const query = input(send);
    expect(query.ScanIndexForward).toBe(false);
    expect(query.FilterExpression).toBe('#type = :type');
    expect(items).toEqual([{ entryId: 'e', type: 'message', text: 'hi' }]);
  });
});

describe('duty state', () => {
  it('clears the pause fields when a driver resumes', async () => {
    const send = vi.fn().mockResolvedValue({ Attributes: { pk: 'p' } });
    await storeWith(send).setDuty('t', 'd', {
      dutyStatus: 'on',
      dutySince: 5,
      pauseReason: null,
      pauseUntil: null,
    });
    expect(input(send).UpdateExpression).toBe(
      'SET #dutyStatus = :dutyStatus, #dutySince = :dutySince REMOVE #pauseReason, #pauseUntil',
    );
  });
});
