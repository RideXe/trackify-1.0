import { describe, expect, it, vi } from 'vitest';
import type { ReverseGeocodeCommand } from '@aws-sdk/client-geo-places';
import { AmazonLocationGeocoder } from '../src/index';

const reply = (label: string) => ({ ResultItems: [{ Address: { Label: label } }] });

describe('reverse geocoding', () => {
  it('asks for longitude first, with the right licence for the use', async () => {
    const send = vi.fn().mockResolvedValue(reply('MG Road, Bengaluru'));
    const geocoder = new AmazonLocationGeocoder({ send } as never);
    expect(await geocoder.address(12.9716, 77.5946, 'storage')).toBe('MG Road, Bengaluru');
    const input = (send.mock.calls[0]?.[0] as ReverseGeocodeCommand).input;
    expect(input).toMatchObject({
      QueryPosition: [77.5946, 12.9716],
      IntendedUse: 'Storage',
      MaxResults: 1,
    });
  });

  it('serves nearby repeats from the cache, per use', async () => {
    const send = vi.fn().mockResolvedValue(reply('Depot'));
    const geocoder = new AmazonLocationGeocoder({ send } as never);
    await geocoder.address(12.97161, 77.59461, 'display');
    await geocoder.address(12.97164, 77.59458, 'display');
    await geocoder.address(12.97164, 77.59458, 'storage');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('never throws, and gives up on a slow lookup', async () => {
    const failing = new AmazonLocationGeocoder({
      send: vi.fn().mockRejectedValue(new Error('denied')),
    } as never);
    expect(await failing.address(1, 2, 'display')).toBeUndefined();
    const slow = new AmazonLocationGeocoder(
      {
        send: vi.fn(
          (_command: unknown, options: { abortSignal: AbortSignal }) =>
            new Promise((_, reject) =>
              options.abortSignal.addEventListener('abort', () => reject(new Error('aborted'))),
            ),
        ),
      } as never,
      { timeoutMs: 10 },
    );
    expect(await slow.address(1, 2, 'display')).toBeUndefined();
  });
});
