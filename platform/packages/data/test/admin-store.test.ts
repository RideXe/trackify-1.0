import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoAdminStore } from '../src/admin-store';

function storeWith(send: ReturnType<typeof vi.fn>) {
  return new DynamoAdminStore({ send } as unknown as DynamoDBDocumentClient, 'core');
}
const input = (send: ReturnType<typeof vi.fn>, call = 0) =>
  (send.mock.calls[call]?.[0] as { input: Record<string, unknown> }).input;

describe('admin store', () => {
  it('stores geofences where fleet processing looks for them', async () => {
    const send = vi.fn().mockResolvedValue({});
    const shape = { type: 'circle' as const, center: { latitude: 1, longitude: 2 }, radiusM: 50 };
    const geofence = await storeWith(send).createGeofence('t', { name: 'Depot', shape });
    const item = input(send).Item as Record<string, unknown>;
    expect(item.pk).toBe('TENANT#t');
    expect(item.sk).toBe(`GEOFENCE#${geofence.geofenceId}`);
    expect(item.geofenceId).toBe(geofence.geofenceId);
    expect(item.shape).toEqual(shape);
    expect(input(send).ConditionExpression).toBe('attribute_not_exists(pk)');
  });

  it('reads every page of a list', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [{ tenantId: 't', groupId: 'a', name: 'A' }],
        LastEvaluatedKey: { pk: 'TENANT#t', sk: 'GROUP#a' },
      })
      .mockResolvedValueOnce({ Items: [{ tenantId: 't', groupId: 'b', name: 'B' }] });
    const groups = await storeWith(send).listGroups('t');
    expect(groups.map((group) => group.groupId)).toEqual(['a', 'b']);
    expect(input(send, 1).ExclusiveStartKey).toEqual({ pk: 'TENANT#t', sk: 'GROUP#a' });
    expect(input(send).ExpressionAttributeValues).toEqual({
      ':pk': 'TENANT#t',
      ':prefix': 'GROUP#',
    });
  });

  it('skips geofences with a shape processing cannot use', async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        { tenantId: 't', geofenceId: 'ok', name: 'Ok', shape: { type: 'polygon', points: [] } },
        { tenantId: 't', geofenceId: 'bad', name: 'Bad', shape: { type: 'line' } },
      ],
    });
    const geofences = await storeWith(send).listGeofences('t');
    expect(geofences.map((geofence) => geofence.geofenceId)).toEqual(['ok']);
  });

  it('reads users with safe defaults for older records', async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [{ tenantId: 't', userId: 'u', role: 'admin', email: 'a@b.c' }],
    });
    expect(await storeWith(send).listUsers('t')).toEqual([
      { tenantId: 't', userId: 'u', role: 'admin', email: 'a@b.c', enabled: true, groupIds: [] },
    ]);
  });

  it('reports whether a delete removed anything', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Attributes: { pk: 'x' } })
      .mockResolvedValueOnce({});
    const store = storeWith(send);
    expect(await store.deleteGroup('t', 'a')).toBe(true);
    expect(await store.deleteGroup('t', 'a')).toBe(false);
    expect(input(send).Key).toEqual({ pk: 'TENANT#t', sk: 'GROUP#a' });
  });
});
