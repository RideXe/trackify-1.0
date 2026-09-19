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
}

export interface Device {
  deviceId: string;
  name: string;
  uniqueId: string;
  protocol: string;
  groupId: string;
  state?: DeviceState;
}

export interface CreateDeviceInput {
  name: string;
  uniqueId: string;
  protocol: 'gt06' | 'teltonika' | 'osmand';
  retentionDays?: number;
  groupId?: string;
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

export class TrackifyClient {
  constructor(
    readonly config: TrackifyConfig,
    private readonly accessToken: () => string | undefined,
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
  positions(deviceId: string, from: number, to: number, limit = 1_000) {
    return this.request<{ items: Array<DeviceState & { fixTime: number }> }>(
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
    if (!token) throw new Error('Sign in required');
    const response = await fetch(`${this.config.apiUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, ...init?.headers },
    });
    if (response.status === 401 || response.status === 403) throw new Error('Access denied');
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => undefined);
      const message =
        isRecord(payload) && typeof payload.message === 'string' ? payload.message : '';
      throw new Error(message || `Request failed (${response.status})`);
    }
    return response.json() as Promise<T>;
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
