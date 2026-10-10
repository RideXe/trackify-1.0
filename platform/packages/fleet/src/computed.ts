import type { PositionMessage } from '@trackify/domain';
import { compile, type CompiledExpression, type Value } from './expression';

/** Position attributes a computed attribute may set; any other name lands in the IO values. */
export const computedTargets = {
  ignition: 'boolean',
  motion: 'boolean',
  charging: 'boolean',
  fuelLevelPct: 'number',
  batteryLevelPct: 'number',
  batteryV: 'number',
  powerV: 'number',
  odometerM: 'number',
  engineHoursS: 'number',
  driverUniqueId: 'string',
} as const;

export interface ComputedAttribute {
  attributeId: string;
  /** Target: one of computedTargets, or a custom name stored with the IO values. */
  attribute: string;
  expression: string;
  type: 'number' | 'boolean' | 'string';
  /** Which vehicles. Both empty means the whole fleet. */
  deviceIds: string[];
  groupIds: string[];
}

const compiled = new Map<string, CompiledExpression | Error>();

function compileOnce(expression: string) {
  let result = compiled.get(expression);
  if (!result) {
    try {
      result = compile(expression);
    } catch (error) {
      result = error instanceof Error ? error : new Error(String(error));
    }
    if (compiled.size > 1_000) compiled.clear();
    compiled.set(expression, result);
  }
  return result;
}

/**
 * The names an expression can read: position fields (speed in km/h as `speed`), decoded
 * attributes, the IO map as `io`, and every IO value directly, with `io.66` also as `io66`.
 */
export function expressionScope(position: PositionMessage): Record<string, unknown> {
  const io = position.attributes.io ?? {};
  const flatIo = Object.fromEntries(
    Object.entries(io).map(([key, value]) => [key.replace(/\./g, ''), value]),
  );
  return {
    ...flatIo,
    ...position.attributes,
    io,
    speed: position.speedKmh,
    speedKmh: position.speedKmh,
    latitude: position.latitude,
    longitude: position.longitude,
    altitude: position.altitudeM,
    course: position.courseDeg,
    accuracy: position.accuracyM,
    valid: position.valid,
    protocol: position.protocol,
  };
}

/**
 * Applies the computed attributes that cover this vehicle, in order, so a later one can use an
 * earlier one's result. A failing expression is skipped rather than blocking the position.
 */
export function applyComputed(
  position: PositionMessage,
  attributes: readonly ComputedAttribute[],
  groupId: string | undefined,
): PositionMessage {
  let current = position;
  for (const attribute of attributes) {
    const covers =
      (!attribute.deviceIds.length && !attribute.groupIds.length) ||
      attribute.deviceIds.includes(position.deviceId) ||
      (groupId !== undefined && attribute.groupIds.includes(groupId));
    if (!covers) continue;
    const expression = compileOnce(attribute.expression);
    if (expression instanceof Error) continue;
    const value = coerce(expression.evaluate(expressionScope(current)), attribute.type);
    if (value === undefined) continue;
    current = withAttribute(current, attribute.attribute, value);
  }
  return current;
}

function coerce(
  value: Value,
  type: ComputedAttribute['type'],
): number | boolean | string | undefined {
  if (value === null) return undefined;
  if (type === 'boolean') return typeof value === 'string' ? value === 'true' : Boolean(value);
  if (type === 'string') return String(value);
  const number = typeof value === 'boolean' ? Number(value) : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function withAttribute(
  position: PositionMessage,
  name: string,
  value: number | boolean | string,
): PositionMessage {
  const known = computedTargets[name as keyof typeof computedTargets];
  if (known) {
    if (typeof value !== known) return position;
    if (name === 'fuelLevelPct' || name === 'batteryLevelPct')
      if ((value as number) < 0 || (value as number) > 100) return position;
    return { ...position, attributes: { ...position.attributes, [name]: value } };
  }
  return {
    ...position,
    attributes: { ...position.attributes, io: { ...position.attributes.io, [name]: value } },
  };
}
