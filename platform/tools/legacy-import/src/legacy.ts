import type { LegacyData } from './mapping';

/** Reads the legacy server's REST API with an administrator's credentials. */
export class LegacyClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authorization: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  static withPassword(baseUrl: string, email: string, password: string) {
    return new LegacyClient(
      baseUrl,
      `Basic ${Buffer.from(`${email}:${password}`).toString('base64')}`,
    );
  }

  async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(`/api/${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    const response = await this.fetcher(url, {
      headers: { authorization: this.authorization, accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`legacy GET ${path} failed: ${response.status}`);
    return (await response.json()) as T;
  }

  /** Everything the plan needs, including which vehicles and groups each notification covers. */
  async load(): Promise<LegacyData> {
    const [
      groups,
      devices,
      latestPositions,
      geofences,
      drivers,
      notifications,
      maintenances,
      computed,
      users,
    ] = await Promise.all([
      this.get<LegacyData['groups']>('groups', { all: 'true' }),
      this.get<LegacyData['devices']>('devices', { all: 'true' }),
      this.get<LegacyData['latestPositions']>('positions'),
      this.get<LegacyData['geofences']>('geofences', { all: 'true' }),
      this.get<LegacyData['drivers']>('drivers', { all: 'true' }),
      this.get<LegacyData['notifications']>('notifications', { all: 'true' }),
      this.get<LegacyData['maintenances']>('maintenance', { all: 'true' }),
      this.get<LegacyData['computed']>('attributes/computed', { all: 'true' }),
      this.get<LegacyData['users']>('users'),
    ]);
    const notificationLinks = new Map<number, { deviceIds: number[]; groupIds: number[] }>();
    const link = (notificationId: number) => {
      const entry = notificationLinks.get(notificationId) ?? { deviceIds: [], groupIds: [] };
      notificationLinks.set(notificationId, entry);
      return entry;
    };
    for (const device of devices)
      for (const notification of await this.get<Array<{ id: number }>>('notifications', {
        deviceId: device.id,
      }))
        link(notification.id).deviceIds.push(device.id);
    for (const group of groups)
      for (const notification of await this.get<Array<{ id: number }>>('notifications', {
        groupId: group.id,
      }))
        link(notification.id).groupIds.push(group.id);
    return {
      groups,
      devices,
      latestPositions,
      geofences,
      drivers,
      notifications,
      notificationLinks,
      maintenances,
      computed,
      users,
    };
  }
}
