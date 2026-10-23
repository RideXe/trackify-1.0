import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type {
  ComputedAttributeInput,
  ComputedAttributeRecord,
  Maintenance,
  MaintenanceInput,
  Membership,
} from '@trackify/data';
import type { PositionMessage } from '@trackify/domain';
import { compile, computedTargets, expressionScope, ExpressionError } from '@trackify/fleet';
import { InputError, jsonObject, optionalText, response, text } from './http';

const MAX_COMPUTED = 50;
const MAX_MAINTENANCES = 100;
const DAY_MS = 86_400_000;

export interface ConfigStore {
  listComputed(tenantId: string): Promise<ComputedAttributeRecord[]>;
  createComputed(tenantId: string, input: ComputedAttributeInput): Promise<ComputedAttributeRecord>;
  updateComputed(
    tenantId: string,
    attributeId: string,
    changes: Partial<ComputedAttributeInput>,
  ): Promise<ComputedAttributeRecord | undefined>;
  deleteComputed(tenantId: string, attributeId: string): Promise<boolean>;
  listMaintenances(tenantId: string): Promise<Maintenance[]>;
  createMaintenance(tenantId: string, input: MaintenanceInput): Promise<Maintenance>;
  updateMaintenance(
    tenantId: string,
    maintenanceId: string,
    changes: Partial<MaintenanceInput>,
  ): Promise<Maintenance | undefined>;
  deleteMaintenance(tenantId: string, maintenanceId: string): Promise<boolean>;
}

export interface LatestPosition {
  latest(tenantId: string, deviceId: string): Promise<PositionMessage | undefined>;
}

/** Computed attributes and maintenance schedules: fleet-wide processing configuration. */
export function createConfigRoutes(store: ConfigStore, positions: LatestPosition) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    membership: Membership,
  ): Promise<ReturnType<typeof response> | undefined> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const { tenantId } = membership;
    if (!path.startsWith('/computed-attributes') && !path.startsWith('/maintenances'))
      return undefined;
    if (method === 'GET' && path === '/maintenances')
      return response(200, { items: await store.listMaintenances(tenantId) });
    if (membership.role !== 'admin') return response(403, { message: 'admin role required' });

    if (path === '/computed-attributes/test' && method === 'POST') {
      const value = jsonObject(event.body);
      const deviceId = text(value.deviceId, 'deviceId', 1, 64);
      const expression = checkedExpression(value.expression);
      const latest = await positions.latest(tenantId, deviceId);
      if (!latest) return response(404, { message: 'no position for this vehicle yet' });
      return response(200, {
        value: compile(expression).evaluate(expressionScope(latest)),
        fixTime: latest.fixTime,
      });
    }
    if (path === '/computed-attributes') {
      if (method === 'GET') return response(200, { items: await store.listComputed(tenantId) });
      if (method === 'POST') {
        const input = parseComputed(event.body) as ComputedAttributeInput;
        if ((await store.listComputed(tenantId)).length >= MAX_COMPUTED)
          return response(409, {
            message: `an account can have at most ${MAX_COMPUTED} computed attributes`,
          });
        return response(201, await store.createComputed(tenantId, input));
      }
    }
    const computedMatch = path.match(/^\/computed-attributes\/([^/]+)$/);
    if (computedMatch?.[1]) {
      if (method === 'PATCH') {
        const record = await store.updateComputed(
          tenantId,
          computedMatch[1],
          parseComputed(event.body, true),
        );
        return record
          ? response(200, record)
          : response(404, { message: 'computed attribute not found' });
      }
      if (method === 'DELETE')
        return (await store.deleteComputed(tenantId, computedMatch[1]))
          ? response(204, undefined)
          : response(404, { message: 'computed attribute not found' });
    }

    if (path === '/maintenances' && method === 'POST') {
      const input = parseMaintenance(event.body) as MaintenanceInput;
      if ((await store.listMaintenances(tenantId)).length >= MAX_MAINTENANCES)
        return response(409, {
          message: `an account can have at most ${MAX_MAINTENANCES} maintenance schedules`,
        });
      return response(201, await store.createMaintenance(tenantId, input));
    }
    const maintenanceMatch = path.match(/^\/maintenances\/([^/]+)$/);
    if (maintenanceMatch?.[1]) {
      if (method === 'PATCH') {
        const changes = parseMaintenance(event.body, true);
        const record = await store.updateMaintenance(tenantId, maintenanceMatch[1], changes);
        return record ? response(200, record) : response(404, { message: 'maintenance not found' });
      }
      if (method === 'DELETE')
        return (await store.deleteMaintenance(tenantId, maintenanceMatch[1]))
          ? response(204, undefined)
          : response(404, { message: 'maintenance not found' });
    }
    return undefined;
  };
}

function checkedExpression(value: unknown) {
  const expression = text(value, 'expression', 1, 500);
  try {
    compile(expression);
  } catch (error) {
    if (error instanceof ExpressionError) throw new InputError(`expression: ${error.message}`);
    throw error;
  }
  return expression;
}

function scope(value: Record<string, unknown>, result: Record<string, unknown>, partial: boolean) {
  for (const key of ['deviceIds', 'groupIds']) {
    const ids = value[key];
    if (ids === undefined) {
      if (!partial) result[key] = [];
      continue;
    }
    if (
      !Array.isArray(ids) ||
      ids.length > 500 ||
      ids.some((id) => typeof id !== 'string' || !id || id.length > 64)
    )
      throw new InputError(`${key} must be a list of ids`);
    result[key] = [...new Set(ids as string[])];
  }
}

function parseComputed(body: string | undefined, partial = false): Partial<ComputedAttributeInput> {
  const value = jsonObject(body);
  const result: Record<string, unknown> = {};
  if (value.attribute !== undefined || !partial) {
    const attribute = text(value.attribute, 'attribute', 1, 40);
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(attribute))
      throw new InputError('attribute must be letters and digits');
    result.attribute = attribute;
  }
  if (value.type !== undefined || !partial) {
    if (value.type !== 'number' && value.type !== 'boolean' && value.type !== 'string')
      throw new InputError('type must be number, boolean or string');
    result.type = value.type;
  }
  const known = computedTargets[result.attribute as keyof typeof computedTargets];
  if (known && result.type !== undefined && known !== result.type)
    throw new InputError(`${String(result.attribute)} must be computed as a ${known}`);
  if (value.expression !== undefined || !partial)
    result.expression = checkedExpression(value.expression);
  if (value.description !== undefined)
    result.description = optionalText(value.description, 'description', 1, 200);
  if (value.order !== undefined || !partial) {
    const order = value.order ?? 0;
    if (typeof order !== 'number' || !Number.isInteger(order) || order < 0 || order > 1_000)
      throw new InputError('order must be a whole number from 0 to 1000');
    result.order = order;
  }
  scope(value, result, partial);
  if (partial && !Object.keys(result).length)
    throw new InputError('at least one field to change is required');
  return result;
}

function parseMaintenance(body: string | undefined, partial = false): Partial<MaintenanceInput> {
  const value = jsonObject(body);
  const result: Record<string, unknown> = {};
  if (value.name !== undefined || !partial) {
    const name = text(value.name, 'name', 1, 100).trim();
    if (!name) throw new InputError('name is invalid');
    result.name = name;
  }
  if (value.type !== undefined || !partial) {
    if (value.type !== 'odometerM' && value.type !== 'engineHoursS' && value.type !== 'fixTime')
      throw new InputError('type must be odometerM, engineHoursS or fixTime');
    result.type = value.type;
  }
  for (const key of ['start', 'period'] as const) {
    if (value[key] === undefined && partial) continue;
    const number = value[key];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0)
      throw new InputError(`${key} must be a non-negative number`);
    result[key] = number;
  }
  if (result.period !== undefined && (result.period as number) <= 0)
    throw new InputError('period must be positive');
  // Time-based schedules count in milliseconds; anything under a day is almost certainly a mistake.
  if (
    result.type === 'fixTime' &&
    result.period !== undefined &&
    (result.period as number) < DAY_MS
  )
    throw new InputError('a time-based period must be at least one day (86400000 ms)');
  scope(value, result, partial);
  if (partial && !Object.keys(result).length)
    throw new InputError('at least one field to change is required');
  return result;
}
