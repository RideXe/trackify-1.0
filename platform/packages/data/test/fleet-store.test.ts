import { describe, expect, it, vi } from 'vitest';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoFleetStore } from '../src/fleet-store';

function storeWith(send: ReturnType<typeof vi.fn>) {
  return new DynamoFleetStore(
    { send } as unknown as DynamoDBDocumentClient,
    'core',
    'state',
    'positions',
  );
}

function sentInput(send: ReturnType<typeof vi.fn>, call = 0) {
  return (send.mock.calls[call]?.[0] as { input: Record<string, unknown> }).input;
}

describe('editing a vehicle', () => {
  it('sets new values and removes fields cleared with null, instead of storing null', async () => {
    const send = vi.fn().mockResolvedValue({
      Attributes: { tenantId: 't', deviceId: 'd', name: 'Van', model: 'Eeco' },
    });
    await storeWith(send).updateDevice('t', 'd', {
      model: 'Eeco',
      colour: null,
      driverId: null,
      fuelType: undefined,
    });
    const input = sentInput(send);
    expect(input.UpdateExpression).toBe('SET #model = :model REMOVE #colour, #driverId');
    expect(input.ExpressionAttributeNames).toEqual({
      '#model': 'model',
      '#colour': 'colour',
      '#driverId': 'driverId',
    });
    expect(input.ExpressionAttributeValues).toEqual({ ':model': 'Eeco' });
    expect(input.ConditionExpression).toBe('attribute_exists(pk)');
  });

  it('sends no values when every change is a removal', async () => {
    const send = vi.fn().mockResolvedValue({ Attributes: { tenantId: 't', deviceId: 'd' } });
    await storeWith(send).updateDevice('t', 'd', { driverId: null });
    const input = sentInput(send);
    expect(input.UpdateExpression).toBe('REMOVE #driverId');
    expect(input).not.toHaveProperty('ExpressionAttributeValues');
  });

  it('returns undefined for a vehicle that does not exist', async () => {
    const send = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' }),
      );
    expect(await storeWith(send).updateDevice('t', 'missing', { model: 'Eeco' })).toBeUndefined();
  });

  it('never invents details: stored junk and missing fields come back unset', async () => {
    const send = vi.fn().mockResolvedValue({
      Item: { tenantId: 't', deviceId: 'd', name: 'Van', fuelType: 'unleaded' },
    });
    const device = await storeWith(send).getDevice('t', 'd');
    expect(device?.fuelType).toBeUndefined();
    expect(device?.model).toBeUndefined();
    expect(device?.driverId).toBeUndefined();
  });
});

describe('drivers', () => {
  it('keeps drivers in the tenant partition', async () => {
    const send = vi.fn().mockResolvedValue({});
    const driver = await storeWith(send).createDriver('t', { name: 'Ramesh Kumar' });
    const item = sentInput(send).Item as Record<string, unknown>;
    expect(item.pk).toBe('TENANT#t');
    expect(item.sk).toBe(`DRIVER#${driver.driverId}`);
    expect(item.name).toBe('Ramesh Kumar');
  });

  it('reports deleting a driver that does not exist as false rather than failing', async () => {
    const send = vi.fn().mockResolvedValue({});
    expect(await storeWith(send).deleteDriver('t', 'missing')).toBe(false);
  });
});
