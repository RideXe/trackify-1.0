import type { DynamoDBRecord } from 'aws-lambda';
import { describe, expect, it, vi } from 'vitest';
import { alarmName, formatMessage } from '../src/format';

process.env.CORE_TABLE = 'core';
process.env.EVENTS_TABLE = 'events';
process.env.POSITIONS_TABLE = 'positions';
process.env.DEVICE_STATE_TABLE = 'state';
process.env.COMMANDS_TABLE = 'commands';
const { createHandler } = await import('../src/handler');

function record(sk: string, eventName: DynamoDBRecord['eventName'] = 'INSERT'): DynamoDBRecord {
  return {
    eventName,
    dynamodb: {
      Keys: { pk: { S: 'TENANT#t#DEVICE#d' }, sk: { S: sk } },
      SequenceNumber: `seq-${sk}`,
    },
  };
}

describe('stream handler', () => {
  it('handles new events only', async () => {
    const handle = vi.fn().mockResolvedValue([]);
    await createHandler({ handle })({
      Records: [record('1'), record('2', 'MODIFY'), record('3', 'REMOVE')],
    });
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('retries from the first failure, keeping stream order', async () => {
    const handle = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValue([]);
    const result = await createHandler({ handle })({
      Records: [record('1'), record('2'), record('3')],
    });
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'seq-2' }]);
    expect(handle).toHaveBeenCalledTimes(2);
  });

  it('does not retry an event whose delivery failed', async () => {
    const handle = vi
      .fn()
      .mockResolvedValue([{ source: 'r', channel: 'sms', outcome: 'failed', reason: 'x' }]);
    const result = await createHandler({ handle })({
      Records: [record('1')],
    });
    expect(result.batchItemFailures).toEqual([]);
  });
});

describe('messages', () => {
  const base = {
    eventTime: Date.parse('2026-10-12T04:30:00Z'),
    deviceName: 'Bus <7>',
    timeZone: 'Asia/Kolkata',
  };

  it('has a sentence for every event type', () => {
    const types = [
      'deviceOnline',
      'deviceOffline',
      'deviceUnknown',
      'deviceInactive',
      'deviceMoving',
      'deviceStopped',
      'deviceOverspeed',
      'deviceFuelDrop',
      'deviceFuelIncrease',
      'ignitionOn',
      'ignitionOff',
      'geofenceEnter',
      'geofenceExit',
      'proximityEnter',
      'proximityExit',
      'unaccompaniedMotion',
      'alarm',
      'commandResult',
      'queuedCommandSent',
      'maintenance',
      'driverChanged',
      'media',
      'tripStarted',
      'tripEnded',
    ] as const;
    for (const type of types) {
      const message = formatMessage({ ...base, type });
      expect(message.text).toMatch(/^Bus <7> .+ at 2026-10-12 10:00:00$/);
    }
  });

  it('names geofences, speeds and limits, and escapes HTML', () => {
    const entered = formatMessage({ ...base, type: 'geofenceEnter', geofenceName: 'Depot' });
    expect(entered.text).toContain('has entered geofence Depot');
    const speeding = formatMessage({
      ...base,
      type: 'deviceOverspeed',
      speedKmh: 92.4,
      speedLimitKmh: 80,
      latitude: 12.97,
      longitude: 77.59,
    });
    expect(speeding.text).toContain('exceeds the speed: 92.4 km/h (limit 80 km/h)');
    expect(speeding.html).toContain('Bus &#60;7&#62;');
    expect(speeding.html).toContain('https://www.google.com/maps?q=12.97,77.59');
  });

  it('turns alarm keys into words', () => {
    expect(alarmName('lowBattery')).toBe('Low battery');
    expect(alarmName('sos')).toBe('SOS');
    expect(alarmName('gpsAntennaCut')).toBe('Gps antenna cut');
  });
});
