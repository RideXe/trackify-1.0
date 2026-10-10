import { describe, expect, it } from 'vitest';
import type { PositionMessage } from '@trackify/domain';
import { applyComputed, compile, ExpressionError, type ComputedAttribute } from '../src/index';

const position = {
  v: 1,
  ingestId: 'i',
  messageId: '0123456789abcdef',
  tenantId: '01J9ZQ3V5X8K2M4N6P7R8S9T0V',
  deviceId: 'van',
  uniqueId: '12345',
  protocol: 'teltonika',
  source: 'gateway',
  retentionDays: 90,
  receivedAt: 1_000,
  fixTime: 1_000,
  valid: true,
  latitude: 12.97,
  longitude: 77.59,
  speedKmh: 42,
  attributes: { ignition: false, io: { 'io.66': 12_480, 'io.1': 5, 'io.270': 820 } },
} satisfies PositionMessage;

const computed = (
  attribute: string,
  expression: string,
  type: ComputedAttribute['type'],
  extra: Partial<ComputedAttribute> = {},
): ComputedAttribute => ({
  attributeId: attribute,
  attribute,
  expression,
  type,
  deviceIds: [],
  groupIds: [],
  ...extra,
});

describe('expressions', () => {
  const evaluate = (source: string, scope: Record<string, unknown> = {}) =>
    compile(source).evaluate(scope);

  it('does arithmetic, comparison, logic, ternaries and functions with normal precedence', () => {
    expect(evaluate('1 + 2 * 3 - 4 / 2')).toBe(5);
    expect(evaluate('(1 + 2) * 3 % 4')).toBe(1);
    expect(evaluate('-2 < 1 && !(3 >= 4) || false')).toBe(true);
    expect(evaluate("x > 10 ? 'fast' : 'slow'", { x: 12 })).toBe('fast');
    expect(evaluate('round(max(1.234, abs(-2.345)), 2)')).toBe(2.35);
    expect(evaluate('bit(5, 0) && !bit(5, 1) && bit(0x05, 2)')).toBe(true);
    expect(evaluate('io["io.66"] / 1000', { io: { 'io.66': 12_480 } })).toBe(12.48);
    expect(evaluate('a.b.c', { a: { b: { c: 7 } } })).toBe(7);
    expect(evaluate('missing + 1')).toBeNaN();
    expect(evaluate('1 / 0')).toBeNull();
  });

  it('cannot reach prototypes, functions or globals', () => {
    expect(evaluate('constructor')).toBeNull();
    expect(evaluate('io.constructor', { io: {} })).toBeNull();
    expect(evaluate('io["__proto__"]', { io: {} })).toBeNull();
    expect(() => compile('process.exit(1)')).toThrow(ExpressionError);
    expect(() => compile('eval("1")')).toThrow(ExpressionError);
  });

  it('rejects malformed or oversized input', () => {
    for (const source of ['1 +', '(1', 'a ? b', '1 2', '"open', '#', 'x'.repeat(501)])
      expect(() => compile(source)).toThrow(ExpressionError);
    expect(() => compile('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/nested/);
  });
});

describe('computed attributes', () => {
  it('maps raw IO values onto known attributes and custom IO names, in order', () => {
    const result = applyComputed(
      position,
      [
        computed('powerV', 'io66 * 0.001', 'number'),
        computed('ignition', 'powerV > 13.2', 'boolean'),
        computed('fuelLevelPct', 'io270 / 10', 'number'),
        computed('doorOpen', 'bit(io1, 2)', 'boolean'),
      ],
      undefined,
    );
    expect(result.attributes).toMatchObject({ powerV: 12.48, ignition: false, fuelLevelPct: 82 });
    expect(result.attributes.io).toMatchObject({ doorOpen: true });
  });

  it('applies only to the chosen vehicles or groups, and skips broken or out-of-range results', () => {
    const result = applyComputed(
      position,
      [
        computed('fuelLevelPct', 'io270', 'number'),
        computed('powerV', '1 +', 'number'),
        computed('batteryLevelPct', '50', 'number', { deviceIds: ['bus'] }),
        computed('charging', 'true', 'boolean', { groupIds: ['north'] }),
      ],
      'north',
    );
    expect(result.attributes.fuelLevelPct).toBeUndefined();
    expect(result.attributes.powerV).toBeUndefined();
    expect(result.attributes.batteryLevelPct).toBeUndefined();
    expect(result.attributes.charging).toBe(true);
  });
});
