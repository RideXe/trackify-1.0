import { describe, expect, it, vi } from 'vitest';
import {
  BatchGetCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import type { PositionMessage } from '@trackify/domain';
import { DynamoFleetProcessingStore } from '../src/fleet-processing-store';

const TENANT = '01J9ZQ3V5X8K2M4N6P7R8S9T0V';
const DEVICE = '01J9ZQ3W1A2B3C4D5E6F7G8H9J';
const tables = {
  core: 'core',
  positions: 'positions',
  state: 'state',
  events: 'events',
  trips: 'trips',
  dailyStats: 'daily',
};

const position = (
  fixTime: number,
  extra: Partial<PositionMessage['attributes']> = {},
): PositionMessage => ({
  v: 1,
  ingestId: 'i',
  messageId: `m-${String(fixTime).padStart(14, '0')}`,
  tenantId: TENANT,
  deviceId: DEVICE,
  uniqueId: '359632101234567',
  protocol: 'teltonika',
  source: 'gateway',
  retentionDays: 90,
  receivedAt: fixTime,
  fixTime,
  valid: true,
  latitude: 12.97,
  longitude: 77.59,
  speedKmh: 0,
  attributes: { io: { 'io.66': 13_800 }, ...extra },
});

function client(
  options: { state?: Record<string, unknown>; device?: Record<string, unknown> } = {},
) {
  const queries: string[] = [];
  const writes: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const send = vi.fn((command: unknown) => {
    if (command instanceof UpdateCommand) {
      updates.push(command.input.ExpressionAttributeValues ?? {});
      return Promise.resolve({});
    }
    if (command instanceof GetCommand) {
      const input = command.input;
      if (input.TableName === 'state') return Promise.resolve({ Item: options.state });
      return Promise.resolve({ Item: { deviceId: DEVICE, groupId: 'north', ...options.device } });
    }
    if (command instanceof QueryCommand) {
      const prefix = String(command.input.ExpressionAttributeValues?.[':prefix']);
      queries.push(prefix);
      if (prefix === 'COMPUTED#')
        return Promise.resolve({
          Items: [
            { attributeId: 'c', attribute: 'powerV', expression: 'io66 * 0.001', type: 'number' },
          ],
        });
      return Promise.resolve({ Items: [] });
    }
    if (command instanceof BatchGetCommand) return Promise.resolve({ Responses: { state: [] } });
    if (command instanceof TransactWriteCommand) {
      writes.push(...(command.input.TransactItems ?? []).map((item) => item.Put?.Item ?? {}));
      return Promise.resolve({});
    }
    return Promise.resolve({});
  });
  return { client: { send } as unknown as DynamoDBDocumentClient, queries, writes, updates };
}

describe('fleet processing: last seen', () => {
  it('counts a late position as contact, so a working tracker does not go offline', async () => {
    const db = client({ state: { pk: 'x', fixTime: 5_000, lastSeenAt: 5_000 } });
    await new DynamoFleetProcessingStore(db.client, tables).process({
      ...position(4_000),
      receivedAt: 9_000,
    });
    expect(db.updates).toContainEqual(expect.objectContaining({ ':seen': 9_000 }));
  });

  it('allows for a phone’s slow sync interval in the offline deadline', async () => {
    const db = client();
    await new DynamoFleetProcessingStore(db.client, tables).process(
      position(1_000, { syncIntervalS: 300 }),
    );
    const state = db.writes.find((item) => item.stalePk === 'ONLINE');
    expect(state).toMatchObject({ lastSeenAt: 1_000, staleSk: 1_000 + 360_000 });
  });
});

describe('fleet processing', () => {
  it('stores positions with computed attributes and the vehicle’s group in live state', async () => {
    const db = client();
    const result = await new DynamoFleetProcessingStore(db.client, tables).process(position(1_000));
    const stored = db.writes.find(
      (item) => String(item.pk).includes('DEVICE') && 'messageId' in item,
    );
    expect(stored?.attributes).toMatchObject({ powerV: 13.8 });
    const state = db.writes.find((item) => item.stalePk === 'ONLINE');
    expect(state?.groupId).toBe('north');
    expect(result).toMatchObject({ groupId: 'north', position: { attributes: { powerV: 13.8 } } });
  });

  it('reads fleet configuration once a minute, not per position', async () => {
    const db = client();
    let now = 0;
    const store = new DynamoFleetProcessingStore(db.client, tables, () => now);
    await store.process(position(1_000));
    await store.process(position(2_000));
    expect(db.queries).toEqual(['GEOFENCE#', 'COMPUTED#', 'MAINT#']);
    now = 61_000;
    await store.process(position(3_000));
    expect(db.queries).toHaveLength(6);
  });

  it('applies an odometer correction once, then counts on from it', async () => {
    const state = {
      fixTime: 500,
      latitude: 12.97,
      longitude: 77.59,
      odometerM: 10,
      motion: false,
      geofencesInside: [],
    };
    const device = { accumulators: { odometerM: 125_000, setAt: 400 } };
    const first = client({ state, device });
    await new DynamoFleetProcessingStore(first.client, tables).process(position(1_000));
    const corrected = first.writes.find((item) => item.stalePk === 'ONLINE');
    expect(corrected).toMatchObject({ odometerM: 125_000, accumulatorsSetAt: 400 });
    const again = client({
      state: { ...state, odometerM: 125_050, accumulatorsSetAt: 400 },
      device,
    });
    await new DynamoFleetProcessingStore(again.client, tables).process(position(2_000));
    expect(again.writes.find((item) => item.stalePk === 'ONLINE')?.odometerM).toBe(125_050);
  });

  it('looks up linked vehicles only when the vehicle has links', async () => {
    const plain = client();
    await new DynamoFleetProcessingStore(plain.client, tables).process(position(1_000));
    const linked = client({
      device: { proximity: { linkedDeviceIds: ['trailer'], enterDistanceM: 50 } },
    });
    await new DynamoFleetProcessingStore(linked.client, tables).process(position(1_000));
    const batchGets = (db: ReturnType<typeof client>) =>
      (db.client.send as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([command]) => command instanceof BatchGetCommand,
      ).length;
    expect(batchGets(plain)).toBe(0);
    expect(batchGets(linked)).toBe(1);
  });
});
