import { describe, expect, it } from 'vitest';
import { devicePartitionKey, positionSortKey, ttlSeconds, uniqueIdLookupKey } from '../src/index';

describe('DynamoDB keys', () => {
  it('keeps tenant and device boundaries explicit', () => {
    expect(devicePartitionKey('tenant', 'device')).toBe('TENANT#tenant#DEVICE#device');
    expect(uniqueIdLookupKey('123')).toBe('UNIQUEID#123');
  });

  it('sorts positions chronologically and preserves same-time records', () => {
    expect(positionSortKey({ fixTime: 42, messageId: 'source:a' })).toBe('0000000000042#source:a');
    expect(positionSortKey({ fixTime: 42, messageId: 'source:b' })).not.toBe(
      positionSortKey({ fixTime: 42, messageId: 'source:a' }),
    );
  });

  it('computes DynamoDB TTL in epoch seconds', () => {
    expect(ttlSeconds(1_000, 1)).toBe(86_401);
    expect(() => ttlSeconds(0, 0)).toThrow('retentionDays');
  });
});
