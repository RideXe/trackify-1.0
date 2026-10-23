import type { Device, FleetEvent } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import { parseSpeedLimit, speedingEpisodes, speedingNow } from './alerts-data';

const vehicle = (id: string, extra: Partial<Device> = {}): Device => ({
  deviceId: id,
  name: `Vehicle ${id}`,
  uniqueId: `gps-${id}`,
  protocol: 'osmand',
  groupId: 'UNGROUPED',
  ...extra,
});
const event = (extra: Partial<FleetEvent>): FleetEvent => ({
  eventId: 'e',
  deviceId: 'a',
  type: 'deviceOverspeed',
  eventTime: 1_000,
  attributes: {},
  ...extra,
});

describe('speeding episodes', () => {
  it('pairs a start with its end: top speed, limit, length and driver', () => {
    const episodes = speedingEpisodes(
      [
        event({ eventId: 's', eventTime: 1_000, attributes: { speedKmh: 72, speedLimitKmh: 60 } }),
        event({
          eventId: 'x',
          type: 'overspeedEnded',
          eventTime: 61_000,
          attributes: {
            startTime: 1_000,
            maxSpeedKmh: 91,
            speedLimitKmh: 60,
            durationS: 60,
            driverId: 'd1',
          },
        }),
      ],
      [vehicle('a')],
    );
    expect(episodes).toEqual([
      expect.objectContaining({
        deviceName: 'Vehicle a',
        maxSpeedKmh: 91,
        speedLimitKmh: 60,
        durationS: 60,
        driverId: 'd1',
        ongoing: false,
      }),
    ]);
  });

  it('shows one still going on with the live top speed, newest first', () => {
    const speeding = vehicle('b', {
      state: {
        overspeeding: true,
        speedKmh: 80,
        overspeed: { startTime: 5_000, maxSpeedKmh: 95, speedLimitKmh: 60 },
      },
    });
    const episodes = speedingEpisodes(
      [
        event({ eventId: 'old', eventTime: 1_000, attributes: { speedKmh: 70 } }),
        event({ eventId: 'now', deviceId: 'b', eventTime: 5_000, attributes: { speedKmh: 66 } }),
      ],
      [vehicle('a'), speeding],
    );
    expect(episodes.map((item) => [item.id, item.ongoing, item.maxSpeedKmh])).toEqual([
      ['now', true, 95],
      ['old', false, 70],
    ]);
    expect(speedingNow([vehicle('a'), speeding])).toEqual([
      expect.objectContaining({ speedKmh: 80, maxSpeedKmh: 95, speedLimitKmh: 60, since: 5_000 }),
    ]);
  });
});

describe('speed limits typed in', () => {
  it('accepts whole km/h from 5 to 300', () => {
    expect(parseSpeedLimit(' 60 ')).toBe(60);
    expect(['4', '301', '60.5', '', 'fast'].map(parseSpeedLimit)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});
