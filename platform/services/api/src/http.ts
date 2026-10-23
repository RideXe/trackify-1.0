/** Request parsing and responses shared by the admin API and the phone API. */

export class InputError extends Error {}

export function jsonObject(body: string | undefined): Record<string, unknown> {
  if (!body) throw new InputError('request body is required');
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new InputError('request body must be JSON');
  }
  if (!isRecord(value)) throw new InputError('request body must be an object');
  return value;
}

/** Undefined is left alone (field not being set); a value present must satisfy the length bounds. */
export function optionalText(
  value: unknown,
  name: string,
  min: number,
  max: number,
): string | undefined {
  return value === undefined ? undefined : text(value, name, min, max);
}

/** null clears an optional field; any other value must be valid for it. */
export function clearable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}

export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max)
    throw new InputError('numeric parameter is outside its allowed range');
  return Math.round(number);
}

export function text(value: unknown, name: string, min: number, max: number): string {
  if (typeof value !== 'string' || value.length < min || value.length > max)
    throw new InputError(`${name} is invalid`);
  return value;
}

export function response(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify(body),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

/** Optional number within bounds; anything else present is an input error. */
export function optionalNumber(value: unknown, name: string, min: number, max: number) {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new InputError(`${name} is invalid`);
  return value;
}
