import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import type {
  FleetRole,
  FleetUser,
  Geofence,
  GeofenceShape,
  Group,
  Membership,
} from '@trackify/data';
import { AccountExistsError, type IdentityDirectory } from './aws';
import { clearable, InputError, jsonObject, optionalText, response, text } from './http';

/** Fleet processing reads every geofence of a tenant in one 1 MB query on each position. */
export const MAX_GEOFENCES = 100;
export const MAX_POLYGON_POINTS = 100;
const MIN_RADIUS_M = 10;
const MAX_RADIUS_M = 100_000;
const MAX_USER_GROUPS = 50;

export interface AdminStore {
  listGroups(tenantId: string): Promise<Group[]>;
  getGroup(tenantId: string, groupId: string): Promise<Group | undefined>;
  createGroup(tenantId: string, input: Pick<Group, 'name' | 'description'>): Promise<Group>;
  updateGroup(
    tenantId: string,
    groupId: string,
    changes: { name?: string; description?: string | null },
  ): Promise<Group | undefined>;
  deleteGroup(tenantId: string, groupId: string): Promise<boolean>;
  listGeofences(tenantId: string): Promise<Geofence[]>;
  createGeofence(
    tenantId: string,
    input: Pick<Geofence, 'name' | 'description' | 'shape'>,
  ): Promise<Geofence>;
  updateGeofence(
    tenantId: string,
    geofenceId: string,
    changes: { name?: string; shape?: GeofenceShape; description?: string | null },
  ): Promise<Geofence | undefined>;
  deleteGeofence(tenantId: string, geofenceId: string): Promise<boolean>;
  listUsers(tenantId: string): Promise<FleetUser[]>;
  getUser(tenantId: string, userId: string): Promise<FleetUser | undefined>;
  createUser(
    tenantId: string,
    input: Pick<FleetUser, 'email' | 'role' | 'groupIds'> & { subject: string },
  ): Promise<FleetUser>;
  deleteUser(tenantId: string, userId: string): Promise<{ subject?: string } | undefined>;
  updateUser(
    tenantId: string,
    userId: string,
    changes: Partial<Pick<FleetUser, 'role' | 'enabled' | 'groupIds'>>,
  ): Promise<FleetUser | undefined>;
}

/** The vehicle operations the admin routes need when a group is removed. */
export interface GroupedDevices {
  listDevices(tenantId: string): Promise<Array<{ deviceId: string; groupId?: string }>>;
  updateDevice(tenantId: string, deviceId: string, changes: { groupId: string }): Promise<unknown>;
}

export const UNGROUPED = 'UNGROUPED';

/**
 * Groups, geofences and users. Returns undefined for paths it does not own, so the main handler
 * can carry on with its own routes.
 */
export function createAdminRoutes(
  admin: AdminStore,
  devices: GroupedDevices,
  identity?: IdentityDirectory,
) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
    membership: Membership,
  ): Promise<ReturnType<typeof response> | undefined> => {
    const method = event.requestContext.http.method;
    const path = event.rawPath;
    const tenantId = membership.tenantId;
    const isAdmin = membership.role === 'admin';
    const adminRequired = response(403, { message: 'admin role required' });

    if (path === '/groups') {
      if (method === 'GET') {
        const groups = await admin.listGroups(tenantId);
        return response(200, { items: groups.filter((group) => sees(membership, group.groupId)) });
      }
      if (method === 'POST') {
        if (!isAdmin) return adminRequired;
        return response(201, await admin.createGroup(tenantId, parseGroup(event.body)));
      }
    }
    const groupMatch = path.match(/^\/groups\/([^/]+)$/);
    if (groupMatch?.[1]) {
      const groupId = groupMatch[1];
      if (!isAdmin) return adminRequired;
      if (method === 'PATCH') {
        const group = await admin.updateGroup(tenantId, groupId, parseGroupChanges(event.body));
        return group ? response(200, group) : response(404, { message: 'group not found' });
      }
      if (method === 'DELETE') {
        if (!(await admin.deleteGroup(tenantId, groupId)))
          return response(404, { message: 'group not found' });
        await releaseGroup(admin, devices, tenantId, groupId);
        return response(204, undefined);
      }
    }

    if (path === '/geofences') {
      if (method === 'GET') return response(200, { items: await admin.listGeofences(tenantId) });
      if (method === 'POST') {
        if (!isAdmin) return adminRequired;
        const input = parseGeofence(event.body);
        if ((await admin.listGeofences(tenantId)).length >= MAX_GEOFENCES)
          return response(409, { message: `a fleet can have at most ${MAX_GEOFENCES} geofences` });
        return response(201, await admin.createGeofence(tenantId, input));
      }
    }
    const geofenceMatch = path.match(/^\/geofences\/([^/]+)$/);
    if (geofenceMatch?.[1]) {
      const geofenceId = geofenceMatch[1];
      if (!isAdmin) return adminRequired;
      if (method === 'PATCH') {
        const changes = parseGeofenceChanges(event.body);
        const geofence = await admin.updateGeofence(tenantId, geofenceId, changes);
        return geofence
          ? response(200, geofence)
          : response(404, { message: 'geofence not found' });
      }
      if (method === 'DELETE') {
        return (await admin.deleteGeofence(tenantId, geofenceId))
          ? response(204, undefined)
          : response(404, { message: 'geofence not found' });
      }
    }

    if (path === '/users') {
      if (!isAdmin) return adminRequired;
      if (method === 'GET') return response(200, { items: await admin.listUsers(tenantId) });
      if (method === 'POST') {
        if (!identity) return response(503, { message: 'user invitations unavailable' });
        const input = parseNewUser(event.body);
        if (input.groupIds.length) await requireGroups(admin, tenantId, input.groupIds);
        const users = await admin.listUsers(tenantId);
        if (users.some((user) => user.email?.toLowerCase() === input.email))
          return response(409, { message: 'this email is already a user of the fleet' });
        let subject: string;
        try {
          subject = await identity.invite(input.email);
        } catch (error) {
          if (error instanceof AccountExistsError) return response(409, { message: error.message });
          throw error;
        }
        try {
          return response(201, await admin.createUser(tenantId, { ...input, subject }));
        } catch (error) {
          // Never leave a sign-in account that belongs to no fleet.
          await identity.remove(subject);
          throw error;
        }
      }
    }
    const userMatch = path.match(/^\/users\/([^/]+)$/);
    if (userMatch?.[1] && (method === 'PATCH' || method === 'DELETE')) {
      if (!isAdmin) return adminRequired;
      const userId = userMatch[1];
      const changes: Partial<Pick<FleetUser, 'role' | 'enabled' | 'groupIds'>> =
        method === 'PATCH' ? parseUserChanges(event.body) : { enabled: false };
      const removesAccess = method === 'DELETE' || changes.enabled === false;
      if (userId === membership.userId && (removesAccess || changes.role !== undefined))
        throw new InputError('you cannot change your own role, disable or remove yourself');
      const users = await admin.listUsers(tenantId);
      const target = users.find((user) => user.userId === userId);
      if (!target) return response(404, { message: 'user not found' });
      if (changes.groupIds) await requireGroups(admin, tenantId, changes.groupIds);
      const losesAdmin =
        target.role === 'admin' &&
        target.enabled &&
        (removesAccess || (changes.role !== undefined && changes.role !== 'admin'));
      const otherAdmins = users.filter(
        (user) => user.userId !== userId && user.role === 'admin' && user.enabled,
      );
      if (losesAdmin && !otherAdmins.length)
        throw new InputError('the fleet must keep at least one active administrator');
      if (method === 'DELETE') {
        const removed = await admin.deleteUser(tenantId, userId);
        if (!removed) return response(404, { message: 'user not found' });
        if (removed.subject && identity) await identity.remove(removed.subject);
        return response(204, undefined);
      }
      const user = await admin.updateUser(tenantId, userId, changes);
      if (!user) return response(404, { message: 'user not found' });
      // The API already refuses disabled users; disabling the account also ends their sign-in.
      if (changes.enabled !== undefined && target.subject && identity)
        await identity.setEnabled(target.subject, changes.enabled);
      return response(200, user);
    }
    return undefined;
  };
}

/** A dispatcher or viewer assigned to groups. Admins and unassigned users see the whole fleet. */
export function limitedToGroups(membership: Membership) {
  return membership.role !== 'admin' && membership.groupIds.length > 0;
}

/** Whether the user may see a vehicle (or anything else) in this group. */
export function sees(membership: Membership, groupId: string | undefined) {
  if (!limitedToGroups(membership)) return true;
  return groupId !== undefined && membership.groupIds.includes(groupId);
}

/** Moves the group's vehicles to ungrouped and drops it from users limited to it. */
async function releaseGroup(
  admin: AdminStore,
  devices: GroupedDevices,
  tenantId: string,
  groupId: string,
) {
  const [vehicles, users] = await Promise.all([
    devices.listDevices(tenantId),
    admin.listUsers(tenantId),
  ]);
  await Promise.all([
    ...vehicles
      .filter((device) => device.groupId === groupId)
      .map((device) => devices.updateDevice(tenantId, device.deviceId, { groupId: UNGROUPED })),
    ...users
      .filter((user) => user.groupIds.includes(groupId))
      .map((user) =>
        admin.updateUser(tenantId, user.userId, {
          groupIds: user.groupIds.filter((id) => id !== groupId),
        }),
      ),
  ]);
}

export async function requireGroups(admin: AdminStore, tenantId: string, groupIds: string[]) {
  const known = new Set((await admin.listGroups(tenantId)).map((group) => group.groupId));
  const missing = groupIds.filter((groupId) => groupId !== UNGROUPED && !known.has(groupId));
  if (missing.length) throw new InputError(`unknown group: ${missing.join(', ')}`);
}

function parseGroup(body: string | undefined) {
  const value = jsonObject(body);
  return {
    name: name(value.name),
    description: optionalText(value.description, 'description', 1, 500),
  };
}

function parseGroupChanges(body: string | undefined) {
  const value = jsonObject(body);
  const changes: { name?: string; description?: string | null } = {};
  if (value.name !== undefined) changes.name = name(value.name);
  if (value.description !== undefined)
    changes.description = clearable(value.description, (description) =>
      text(description, 'description', 1, 500),
    );
  return requireChanges(changes);
}

function parseGeofence(body: string | undefined) {
  const value = jsonObject(body);
  return {
    name: name(value.name),
    description: optionalText(value.description, 'description', 1, 500),
    shape: shape(value.shape),
  };
}

function parseGeofenceChanges(body: string | undefined) {
  const value = jsonObject(body);
  const changes: { name?: string; shape?: GeofenceShape; description?: string | null } = {};
  if (value.name !== undefined) changes.name = name(value.name);
  if (value.shape !== undefined) changes.shape = shape(value.shape);
  if (value.description !== undefined)
    changes.description = clearable(value.description, (description) =>
      text(description, 'description', 1, 500),
    );
  return requireChanges(changes);
}

function parseUserChanges(body: string | undefined) {
  const value = jsonObject(body);
  const changes: Partial<Pick<FleetUser, 'role' | 'enabled' | 'groupIds'>> = {};
  if (value.role !== undefined) changes.role = role(value.role);
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new InputError('enabled must be true or false');
    changes.enabled = value.enabled;
  }
  if (value.groupIds !== undefined) changes.groupIds = groupIdList(value.groupIds);
  return requireChanges(changes);
}

function groupIdList(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > MAX_USER_GROUPS ||
    value.some((id) => typeof id !== 'string' || !id || id.length > 64)
  )
    throw new InputError(`groupIds must be a list of at most ${MAX_USER_GROUPS} group ids`);
  return [...new Set(value as string[])];
}

function parseNewUser(body: string | undefined) {
  const value = jsonObject(body);
  const email = text(value.email, 'email', 3, 254).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('email is invalid');
  const groupIds = value.groupIds === undefined ? [] : groupIdList(value.groupIds);
  return { email, role: role(value.role), groupIds };
}

function role(value: unknown): FleetRole {
  if (value !== 'admin' && value !== 'dispatcher' && value !== 'viewer')
    throw new InputError('role must be admin, dispatcher or viewer');
  return value;
}

function name(value: unknown) {
  const trimmed = text(value, 'name', 1, 100).trim();
  if (!trimmed) throw new InputError('name is invalid');
  return trimmed;
}

function shape(value: unknown): GeofenceShape {
  if (typeof value !== 'object' || value === null) throw new InputError('shape is invalid');
  const input = value as Record<string, unknown>;
  if (input.type === 'circle') {
    const radiusM = input.radiusM;
    if (
      typeof radiusM !== 'number' ||
      !Number.isFinite(radiusM) ||
      radiusM < MIN_RADIUS_M ||
      radiusM > MAX_RADIUS_M
    )
      throw new InputError(`radiusM must be from ${MIN_RADIUS_M} to ${MAX_RADIUS_M} metres`);
    return { type: 'circle', center: point(input.center), radiusM };
  }
  if (input.type === 'polygon') {
    const points = input.points;
    if (!Array.isArray(points) || points.length < 3 || points.length > MAX_POLYGON_POINTS)
      throw new InputError(`a polygon needs 3 to ${MAX_POLYGON_POINTS} points`);
    return { type: 'polygon', points: points.map(point) };
  }
  throw new InputError('shape type must be circle or polygon');
}

function point(value: unknown) {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const { latitude, longitude } = input;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    throw new InputError('each point needs a valid latitude and longitude');
  return { latitude, longitude };
}

function requireChanges<T extends object>(changes: T): T {
  if (!Object.keys(changes).length)
    throw new InputError('at least one field to change is required');
  return changes;
}
