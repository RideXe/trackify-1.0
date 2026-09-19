import type { SQSRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import type { FleetProcessingStore } from '@trackify/data';

process.env.POSITIONS_TABLE = 'positions';
process.env.DEVICE_STATE_TABLE = 'state';
process.env.CORE_TABLE = 'core';
process.env.EVENTS_TABLE = 'events';
process.env.TRIPS_TABLE = 'trips';
process.env.DAILY_STATS_TABLE = 'daily';
const { createHandler } = await import('../src/handler');

function record(id: string, body: unknown, group = 'device-a'): SQSRecord {
  return {
    messageId: id,
    body: JSON.stringify(body),
    attributes: { MessageGroupId: group },
  } as SQSRecord;
}

const valid = {
  v: 1,
  ingestId: '01J9ZQ3X9K8J7H6G5F4E3D2C1B',
  messageId: 'http:0123456789abcdef',
  tenantId: '01J9ZQ3V5X8K2M4N6P7R8S9T0V',
  deviceId: '01J9ZQ3W1A2B3C4D5E6F7G8H9J',
  uniqueId: '359632101234567',
  protocol: 'osmand',
  source: 'http',
  retentionDays: 90,
  receivedAt: 1_757_836_800_500,
  fixTime: 1_757_836_800_000,
  valid: true,
  latitude: 12.9716,
  longitude: 77.5946,
  attributes: {},
};

describe('position processor', () => {
  it('saves valid positions', async () => {
    const process = vi.fn().mockResolvedValue({ duplicate: false, eventCount: 0 });
    const publish = vi.fn().mockResolvedValue(undefined);
    const result = await createHandler({ process } satisfies FleetProcessingStore, { publish })({
      Records: [record('a', valid)],
    });
    expect(result.batchItemFailures).toEqual([]);
    expect(process).toHaveBeenCalledWith(expect.objectContaining({ deviceId: valid.deviceId }));
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ deviceId: valid.deviceId }));
  });

  it('returns a failure and all later messages in the same FIFO group', async () => {
    const process = vi.fn().mockRejectedValueOnce(new Error('database unavailable'));
    const result = await createHandler({ process } satisfies FleetProcessingStore)({
      Records: [
        record('first', valid),
        record('second', { ...valid, messageId: 'http:fedcba9876543210' }),
      ],
    });
    expect(result.batchItemFailures).toEqual([
      { itemIdentifier: 'first' },
      { itemIdentifier: 'second' },
    ]);
    expect(process).toHaveBeenCalledTimes(1);
  });
});
