import type { FuelType, VehicleType } from '@trackify/domain/vehicle';
import type {
  ActivityEntry,
  ActivityType,
  AlertSeverity,
  DutyStatus,
  IssueKind,
  PauseReason,
  WarningKind,
} from '@trackify/domain/activity';

export * from '@trackify/domain/activity';

export {
  defaultVehicleType,
  fuelTypes,
  isFuelType,
  toVehicleType,
  vehicleTypes,
  type FuelType,
  type VehicleType,
} from '@trackify/domain/vehicle';

export interface TrackifyConfig {
  apiUrl: string;
  awsRegion: string;
  clientId: string;
  realtimeDns: string;
}

export interface Tokens {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface DeviceState {
  status?: string;
  lastSeenAt?: number;
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  courseDeg?: number;
  fixTime?: number;
  accuracyM?: number;
  /** Server-side movement decision; GPS drift while parked does not count. */
  motion?: boolean;
  /** Total distance tracked for this vehicle. */
  odometerM?: number;
  /** The trip in progress, if the vehicle is moving. */
  trip?: { startTime: number; distanceM: number; maxSpeedKmh: number };
}

/** One stored GPS fix, as returned by the position history API. */
export interface StoredPosition {
  fixTime: number;
  messageId: string;
  valid: boolean;
  latitude: number;
  longitude: number;
  altitudeM?: number;
  speedKmh?: number;
  courseDeg?: number;
  accuracyM?: number;
}

export interface Device {
  deviceId: string;
  name: string;
  uniqueId: string;
  protocol: string;
  groupId: string;
  /** Missing from servers deployed before vehicle types existed; treat as the default. */
  vehicleType?: VehicleType;
  /** Admin-entered details. Missing means not entered; never fill them in with a guess. */
  model?: string;
  fuelType?: FuelType;
  /** Calendar date, YYYY-MM-DD. */
  purchasedOn?: string;
  colour?: string;
  /** May name a driver that was removed since; treat that as no driver assigned. */
  driverId?: string;
  /** Admin-set phone behaviour; unset means the defaults in @trackify/domain/activity. */
  trackerIntervalSeconds?: number;
  pauseLimitMinutes?: number;
  /** What the driver last reported from the phone app; unset means never on a shift. */
  dutyStatus?: DutyStatus;
  dutySince?: number;
  pauseReason?: PauseReason;
  pauseUntil?: number;
  state?: DeviceState;
}

export interface Organisation {
  tenantId: string;
  name: string;
  dispatcherPhone?: string;
}

export interface FleetAlert {
  alertId: string;
  deviceId: string;
  deviceName: string;
  entryId: string;
  type: ActivityType;
  kind?: IssueKind | WarningKind;
  severity: AlertSeverity;
  status: 'open' | 'acknowledged';
  createdAt: number;
  latitude?: number;
  longitude?: number;
  note?: string;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
}

/** One completed trip, as recorded when the vehicle stopped. */
export interface FleetTrip {
  tripId: string;
  deviceId: string;
  deviceName?: string;
  startTime: number;
  endTime: number;
  distanceM: number;
  maxSpeedKmh: number;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
}

/** A driver entry as the dashboard reads it; photoUrl is a link that expires in 15 minutes. */
export type ActivityItem = ActivityEntry & { photoUrl?: string };

/** Everything about a vehicle an administrator can edit. null clears an optional field. */
export interface DeviceChanges {
  name?: string;
  vehicleType?: VehicleType;
  model?: string | null;
  fuelType?: FuelType | null;
  purchasedOn?: string | null;
  colour?: string | null;
  /** null unassigns the current driver. */
  driverId?: string | null;
  trackerIntervalSeconds?: number;
  pauseLimitMinutes?: number;
}

/** A person who drives the tenant's vehicles; every detail is admin-entered. */
export interface Driver {
  driverId: string;
  name: string;
  phone?: string;
  licenceNumber?: string;
}

export interface DriverInput {
  name: string;
  phone?: string;
  licenceNumber?: string;
}

/** null clears an optional detail. */
export interface DriverChanges {
  name?: string;
  phone?: string | null;
  licenceNumber?: string | null;
}

export interface CreateDeviceInput {
  name: string;
  uniqueId: string;
  protocol: 'gt06' | 'teltonika' | 'osmand';
  retentionDays?: number;
  groupId?: string;
  vehicleType?: VehicleType;
}

export type SignInResult =
  | { status: 'authenticated'; tokens: Tokens }
  | { status: 'new-password-required'; username: string; session: string };

export class CognitoPasswordClient {
  constructor(private readonly config: Pick<TrackifyConfig, 'awsRegion' | 'clientId'>) {}

  async signIn(username: string, password: string): Promise<SignInResult> {
    const response = await this.call('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: this.config.clientId,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    });
    if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
      if (typeof response.Session !== 'string') throw new Error('Sign-in session was not returned');
      return { status: 'new-password-required', username, session: response.Session };
    }
    return { status: 'authenticated', tokens: readAuthenticationResult(response) };
  }

  async setNewPassword(username: string, password: string, session: string): Promise<Tokens> {
    const response = await this.call('RespondToAuthChallenge', {
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      ClientId: this.config.clientId,
      ChallengeResponses: { USERNAME: username, NEW_PASSWORD: password },
      Session: session,
    });
    return readAuthenticationResult(response);
  }

  /** Fresh access and ID tokens. Cognito only returns a new refresh token when it rotates them. */
  async refresh(refreshToken: string): Promise<Tokens> {
    const response = await this.call('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: this.config.clientId,
      AuthParameters: { REFRESH_TOKEN: refreshToken },
    });
    const tokens = readAuthenticationResult(response);
    return { ...tokens, refresh_token: tokens.refresh_token ?? refreshToken };
  }

  private async call(operation: string, body: Record<string, unknown>) {
    const response = await fetch(`https://cognito-idp.${this.config.awsRegion}.amazonaws.com/`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify(body),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(cognitoError(payload));
    if (!isRecord(payload)) throw new Error('Cognito returned an invalid response');
    return payload;
  }
}

/** The API rejected the sign-in and it could not be renewed; the user must sign in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your session expired. Please sign in again.');
    this.name = 'SessionExpiredError';
  }
}

export class TrackifyClient {
  private renewal: Promise<string | undefined> | undefined;

  constructor(
    readonly config: TrackifyConfig,
    private readonly accessToken: () => string | undefined,
    /** Called when the API answers 401. Returns a fresh access token, or undefined to give up. */
    private readonly renewAccessToken?: () => Promise<string | undefined>,
  ) {}

  me() {
    return this.request<{ tenantId: string; userId: string; role: string; email?: string }>('/me');
  }
  devices() {
    return this.request<{ items: Device[] }>('/devices');
  }
  createDevice(input: CreateDeviceInput) {
    return this.request<Device>('/devices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }
  /** Administrators only. */
  updateDevice(deviceId: string, changes: DeviceChanges) {
    return this.request<Device>(`/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    });
  }
  /** Administrators only. Historical positions/events/trips still expire on their own TTL. */
  deleteDevice(deviceId: string) {
    return this.request<void>(`/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  }
  drivers() {
    return this.request<{ items: Driver[] }>('/drivers');
  }
  /** Administrators only. */
  createDriver(input: DriverInput) {
    return this.request<Driver>('/drivers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  }
  /** Administrators only. */
  updateDriver(driverId: string, changes: DriverChanges) {
    return this.request<Driver>(`/drivers/${encodeURIComponent(driverId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    });
  }
  /** Administrators only. Also unassigns the driver from every vehicle they were on. */
  deleteDriver(driverId: string) {
    return this.request<void>(`/drivers/${encodeURIComponent(driverId)}`, { method: 'DELETE' });
  }
  organisation() {
    return this.request<Organisation>('/organisation');
  }
  /** Administrators only. A null dispatcher phone removes it. */
  updateOrganisation(changes: { name?: string; dispatcherPhone?: string | null }) {
    return this.request<Organisation>('/organisation', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changes),
    });
  }
  /**
   * Completed trips across the fleet (or one vehicle), newest first. At most 31 days per call;
   * `truncated` means a vehicle had more trips than one call returns.
   */
  fleetTrips(from: number, to: number, deviceId?: string) {
    const query = new URLSearchParams({ from: String(from), to: String(to) });
    if (deviceId) query.set('deviceId', deviceId);
    return this.request<{ items: FleetTrip[]; truncated: boolean }>(`/trips?${query}`);
  }
  /** The most recent alerts, newest first, open and acknowledged alike. */
  alerts() {
    return this.request<{ items: FleetAlert[] }>('/alerts');
  }
  /** Dispatchers and administrators. */
  acknowledgeAlert(alertId: string) {
    return this.request<FleetAlert>(`/alerts/${encodeURIComponent(alertId)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'acknowledged' }),
    });
  }
  /** Driver entries and admin messages, newest first. Defaults to the last seven days. */
  activity(deviceId: string, from?: number, to?: number) {
    const query = new URLSearchParams();
    if (from !== undefined) query.set('from', String(from));
    if (to !== undefined) query.set('to', String(to));
    return this.request<{ items: ActivityItem[] }>(
      `/devices/${encodeURIComponent(deviceId)}/activity${query.size ? `?${query}` : ''}`,
    );
  }
  /** Shows on the driver's phone the next time the app checks for messages. */
  sendMessage(deviceId: string, text: string) {
    return this.request<ActivityEntry>(`/devices/${encodeURIComponent(deviceId)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  }
  /** Newest first; at most `limit` (max 5,000) fixes per call. */
  positions(deviceId: string, from: number, to: number, limit = 1_000) {
    return this.request<{ items: StoredPosition[] }>(
      `/devices/${encodeURIComponent(deviceId)}/positions?from=${from}&to=${to}&limit=${limit}`,
    );
  }
  events(deviceId: string, from: number, to: number, limit = 100) {
    return this.request<{ items: Array<Record<string, unknown>> }>(
      `/devices/${encodeURIComponent(deviceId)}/events?from=${from}&to=${to}&limit=${limit}`,
    );
  }
  trips(deviceId: string, from: number, to: number, limit = 100) {
    return this.request<{ items: Array<Record<string, unknown>> }>(
      `/devices/${encodeURIComponent(deviceId)}/trips?from=${from}&to=${to}&limit=${limit}`,
    );
  }
  summary(deviceId: string, from?: string, to?: string) {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    return this.request<{ items: Array<Record<string, unknown>> }>(
      `/devices/${encodeURIComponent(deviceId)}/summary${query.size ? `?${query}` : ''}`,
    );
  }

  subscribeFleet(tenantId: string, onUpdate: (state: DeviceState & { deviceId: string }) => void) {
    const token = this.accessToken();
    if (!token || !this.config.realtimeDns) return () => undefined;
    const authorization = { Authorization: token, host: this.config.realtimeDns };
    const header = base64Url(JSON.stringify(authorization));
    const socket = new WebSocket(
      `wss://${this.config.realtimeDns}/event/realtime?header=${header}&payload=e30=`,
      ['aws-appsync-event-ws'],
    );
    let subscriptionId = '';
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'connection_init' })));
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (message.type === 'connection_ack') {
        subscriptionId = randomId();
        socket.send(
          JSON.stringify({
            type: 'subscribe',
            id: subscriptionId,
            channel: `/fleet/${tenantId}`,
            authorization,
          }),
        );
      }
      if (message.type === 'data') {
        const raw = message.event ?? message.data;
        const update: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (isDeviceUpdate(update)) onUpdate(update);
      }
    });
    return () => {
      if (subscriptionId && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'unsubscribe', id: subscriptionId }));
      }
      socket.close();
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.accessToken();
    if (!token) throw new SessionExpiredError();
    const send = (bearer: string) =>
      fetch(`${this.config.apiUrl}${path}`, {
        ...init,
        headers: { authorization: `Bearer ${bearer}`, ...init?.headers },
      });
    let response = await send(token);
    if (response.status === 401) {
      // Access tokens last an hour; renew once and retry before giving up on the session.
      const renewed = await this.renew();
      if (renewed) response = await send(renewed);
    }
    if (response.status === 401) throw new SessionExpiredError();
    if (response.status === 403) throw new Error('Access denied');
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined);
      const message =
        isRecord(payload) && typeof payload.message === 'string' ? payload.message : '';
      throw new Error(message || `Request failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  /** Requests that fail together share one renewal instead of each spending the refresh token. */
  private renew(): Promise<string | undefined> {
    if (!this.renewAccessToken) return Promise.resolve(undefined);
    this.renewal ??= this.renewAccessToken()
      .catch(() => undefined)
      .finally(() => {
        this.renewal = undefined;
      });
    return this.renewal;
  }
}

function base64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function randomId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDeviceUpdate(value: unknown): value is DeviceState & { deviceId: string } {
  return isRecord(value) && typeof value.deviceId === 'string';
}

function readAuthenticationResult(response: Record<string, unknown>): Tokens {
  const result = response.AuthenticationResult;
  if (!isRecord(result) || typeof result.AccessToken !== 'string') {
    throw new Error('Cognito did not return authentication tokens');
  }
  return {
    access_token: result.AccessToken,
    id_token: typeof result.IdToken === 'string' ? result.IdToken : undefined,
    refresh_token: typeof result.RefreshToken === 'string' ? result.RefreshToken : undefined,
    expires_in: typeof result.ExpiresIn === 'number' ? result.ExpiresIn : undefined,
  };
}

function cognitoError(payload: unknown) {
  if (!isRecord(payload)) return 'Sign-in failed';
  const code = typeof payload.__type === 'string' ? payload.__type.split('#').at(-1) : '';
  if (code === 'NotAuthorizedException') return 'Incorrect email or password';
  if (code === 'UserNotFoundException') return 'Incorrect email or password';
  if (code === 'UserNotConfirmedException') return 'This account has not been confirmed';
  if (code === 'PasswordResetRequiredException') return 'A password reset is required';
  if (code === 'TooManyRequestsException') return 'Too many attempts. Please try again shortly';
  return typeof payload.message === 'string' ? payload.message : 'Sign-in failed';
}

export function tokenExpired(token: string, marginMs = 30_000) {
  const encoded = token.split('.')[1];
  if (!encoded) return true;
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const payload = JSON.parse(globalThis.atob(normalized)) as { exp?: number };
  return typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now() + marginMs;
}
