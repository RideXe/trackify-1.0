import { describe, expect, it, vi } from 'vitest';
import { UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoPresenceStore } from '../src/presence-store';

const TENANT = '01J9ZQ3V5X8K2M4N6P7R8S9T0V';
const DEVICE = '01J9ZQ3W1A2B3C4D5E6F7G8H9J';

describe('presence', () => {
  it('refreshes last seen and the offline deadline without touching the position', async () => {
    const send = vi.fn().mockResolvedValue({});
    const store = new DynamoPresenceStore({ send } as unknown as DynamoDBDocumentClient, 'state');
    expect(await store.markSeen(TENANT, DEVICE, 1_000_000, 300)).toBe(true);
    const command = send.mock.calls[0]![0] as UpdateCommand;
    expect(command).toBeInstanceOf(UpdateCommand);
    expect(command.input.UpdateExpression).not.toMatch(/latitude|fixTime/);
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ':seen': 1_000_000,
      ':online': 'online',
      ':stalePk': 'ONLINE',
      // 11 minutes allowed at a 5-minute interval, stored relative to the sweeper's 5 minutes.
      ':staleSk': 1_000_000 + 360_000,
    });
  });

  it('does nothing for a vehicle with no live record or a later contact', async () => {
    const error = Object.assign(new Error('no'), { name: 'ConditionalCheckFailedException' });
    const send = vi.fn().mockRejectedValue(error);
    const store = new DynamoPresenceStore({ send } as unknown as DynamoDBDocumentClient, 'state');
    expect(await store.markSeen(TENANT, DEVICE, 1_000_000)).toBe(false);
  });
});
