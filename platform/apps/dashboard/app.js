/* global window, document, crypto, TextEncoder, sessionStorage, URL, URLSearchParams, location, fetch, history, WebSocket, setTimeout, atob, btoa */
const config = window.TRACKIFY_CONFIG;
const state = { devices: [], membership: null, socket: null, selectedDeviceId: null };
const byId = (id) => document.getElementById(id);

byId('sign-in').addEventListener('click', signIn);
byId('sign-out').addEventListener('click', signOut);
byId('search').addEventListener('input', render);

start().catch(showLoginError);

async function start() {
  await finishCallback();
  const tokens = tokensFromSession();
  if (!tokens || tokenExpired(tokens.access_token)) return;
  byId('login').classList.add('hidden');
  byId('dashboard').classList.remove('hidden');
  const [membership, fleet] = await Promise.all([api('/me'), api('/devices')]);
  state.membership = membership;
  state.devices = fleet.items;
  byId('fleet-name').textContent = `${fleet.items.length} vehicles`;
  render();
  connectRealtime(tokens.access_token, membership.tenantId);
}

async function signIn() {
  assertConfigured();
  const verifier = randomBase64(64);
  const challenge = base64Url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  const authState = randomBase64(24);
  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state', authState);
  const url = new URL(`https://${config.cognitoDomain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: authState,
  });
  location.assign(url);
}

async function finishCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (!code) return;
  if (url.searchParams.get('state') !== sessionStorage.getItem('oauth_state'))
    throw new Error('The sign-in response could not be verified.');
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: sessionStorage.getItem('pkce_verifier') ?? '',
  });
  const response = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error('Sign-in token exchange failed.');
  sessionStorage.setItem('tokens', JSON.stringify(await response.json()));
  sessionStorage.removeItem('pkce_verifier');
  sessionStorage.removeItem('oauth_state');
  history.replaceState({}, '', location.pathname);
}

async function api(path, options = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${tokensFromSession().access_token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401 || response.status === 403)
    throw new Error('Your account has no fleet access.');
  if (!response.ok) throw new Error('Fleet data is temporarily unavailable.');
  return response.json();
}

function connectRealtime(token, tenantId) {
  if (!config.realtimeDns) {
    setConnection('Snapshot');
    return;
  }
  const authorization = { Authorization: token, host: config.realtimeDns };
  const header = base64Url(new TextEncoder().encode(JSON.stringify(authorization)));
  const socket = new WebSocket(
    `wss://${config.realtimeDns}/event/realtime?header=${header}&payload=e30=`,
    ['aws-appsync-event-ws'],
  );
  state.socket = socket;
  socket.onopen = () => socket.send(JSON.stringify({ type: 'connection_init' }));
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'connection_ack') {
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          id: crypto.randomUUID(),
          channel: `/fleet/${tenantId}`,
          authorization,
        }),
      );
      setConnection('Live');
    }
    if (message.type === 'data') applyLiveEvent(message.event ?? message.data);
  };
  socket.onclose = () => {
    setConnection('Reconnecting');
    setTimeout(() => connectRealtime(token, tenantId), 2_000);
  };
}

function applyLiveEvent(raw) {
  const update = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const index = state.devices.findIndex((device) => device.deviceId === update.deviceId);
  if (index < 0) return;
  state.devices[index] = { ...state.devices[index], state: update };
  render();
}

function render() {
  const search = byId('search').value.toLowerCase();
  const devices = state.devices.filter((device) => device.name.toLowerCase().includes(search));
  byId('device-list').replaceChildren(...devices.map(deviceRow));
  const positioned = devices.filter((device) => Number.isFinite(device.state?.latitude));
  byId('markers').replaceChildren(...positioned.map(marker));
  const online = devices.filter((device) => device.state?.status === 'online').length;
  byId('map-summary').textContent = `${online} online · ${devices.length - online} quiet`;
}

function deviceRow(device) {
  const button = document.createElement('button');
  button.className = 'device';
  button.innerHTML = `<span class="dot ${device.state?.status === 'online' ? 'online' : ''}"></span><span><strong>${escapeHtml(device.name)}</strong><small>${Math.round(device.state?.speedKmh ?? 0)} km/h · ${relativeTime(device.state?.lastSeenAt)}</small></span>`;
  button.addEventListener('click', () => showDevice(device));
  return button;
}

function marker(device) {
  const point = project(device.state.latitude, device.state.longitude);
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  group.setAttribute('class', 'marker');
  group.setAttribute('transform', `translate(${point.x} ${point.y})`);
  group.innerHTML = `<circle r="18"></circle><path d="M0 -10 L7 9 L0 5 L-7 9 Z"></path>`;
  group.addEventListener('click', () => showDevice(device));
  return group;
}

function project(latitude, longitude) {
  const all = state.devices.map((d) => d.state).filter((p) => Number.isFinite(p?.latitude));
  const lats = all.map((p) => p.latitude);
  const lons = all.map((p) => p.longitude);
  const minLat = Math.min(...lats) - 0.01;
  const maxLat = Math.max(...lats) + 0.01;
  const minLon = Math.min(...lons) - 0.01;
  const maxLon = Math.max(...lons) + 0.01;
  return {
    x: 80 + ((longitude - minLon) / (maxLon - minLon)) * 1040,
    y: 720 - ((latitude - minLat) / (maxLat - minLat)) * 640,
  };
}

async function showDevice(device) {
  state.selectedDeviceId = device.deviceId;
  const detail = byId('detail');
  detail.classList.remove('hidden');
  detail.innerHTML = `<p class="section-label">Selected vehicle</p><h2>${escapeHtml(device.name)}</h2><div class="metric"><strong>${Math.round(device.state?.speedKmh ?? 0)}</strong><span>km/h</span></div><p>${device.state?.latitude?.toFixed(5) ?? 'No fix'}, ${device.state?.longitude?.toFixed(5) ?? 'No fix'}</p><p class="muted">Loading today’s activity…</p>`;
  const now = Date.now();
  const start = now - 86_400_000;
  try {
    const [positions, events, trips, summary] = await Promise.all([
      api(
        `/devices/${encodeURIComponent(device.deviceId)}/positions?from=${start}&to=${now}&limit=1000`,
      ),
      api(
        `/devices/${encodeURIComponent(device.deviceId)}/events?from=${start}&to=${now}&limit=20`,
      ),
      api(`/devices/${encodeURIComponent(device.deviceId)}/trips?from=${start}&to=${now}&limit=20`),
      api(`/devices/${encodeURIComponent(device.deviceId)}/summary`),
    ]);
    if (state.selectedDeviceId !== device.deviceId) return;
    drawRoute(positions.items);
    const totals = summary.items.reduce(
      (result, item) => ({
        distanceM: result.distanceM + Number(item.distanceM ?? 0),
        tripCount: result.tripCount + Number(item.tripCount ?? 0),
      }),
      { distanceM: 0, tripCount: 0 },
    );
    detail.innerHTML = `<p class="section-label">Selected vehicle</p><h2>${escapeHtml(device.name)}</h2><div class="metric"><strong>${Math.round(device.state?.speedKmh ?? 0)}</strong><span>km/h</span></div><p>${device.state?.latitude?.toFixed(5) ?? 'No fix'}, ${device.state?.longitude?.toFixed(5) ?? 'No fix'}</p><div class="activity"><span><strong>${(totals.distanceM / 1000).toFixed(1)}</strong><small>km today</small></span><span><strong>${totals.tripCount || trips.items.length}</strong><small>trips</small></span><span><strong>${events.items.length}</strong><small>events</small></span></div>${activityList(events.items)}`;
  } catch (error) {
    if (state.selectedDeviceId === device.deviceId) {
      detail.insertAdjacentHTML(
        'beforeend',
        `<p class="error">${escapeHtml(error instanceof Error ? error.message : 'History unavailable.')}</p>`,
      );
    }
  }
}

function drawRoute(items) {
  const points = items
    .filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    .sort((left, right) => left.fixTime - right.fixTime)
    .map((item) => project(item.latitude, item.longitude))
    .map((point) => `${point.x},${point.y}`)
    .join(' ');
  byId('route').setAttribute('points', points);
}

function activityList(items) {
  if (items.length === 0) return '<p class="muted">No events in the last 24 hours.</p>';
  return `<div class="event-list">${items
    .slice(0, 5)
    .map(
      (item) =>
        `<p><strong>${escapeHtml(eventLabel(item.type))}</strong><small>${relativeTime(item.eventTime)}</small></p>`,
    )
    .join('')}</div>`;
}

function eventLabel(type) {
  return String(type ?? 'event')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function signOut() {
  state.socket?.close();
  sessionStorage.clear();
  const url = new URL(`https://${config.cognitoDomain}/logout`);
  url.search = new URLSearchParams({ client_id: config.clientId, logout_uri: config.redirectUri });
  location.assign(url);
}

function tokensFromSession() {
  const value = sessionStorage.getItem('tokens');
  return value ? JSON.parse(value) : null;
}

function tokenExpired(token) {
  const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  return payload.exp * 1000 < Date.now() + 30_000;
}

function randomBase64(length) {
  return base64Url(crypto.getRandomValues(new Uint8Array(length)));
}

function base64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function relativeTime(value) {
  if (!value) return 'never seen';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

function setConnection(text) {
  byId('connection').textContent = text;
}

function showLoginError(error) {
  byId('login-error').textContent = error instanceof Error ? error.message : 'Unable to start.';
  byId('login').classList.remove('hidden');
  byId('dashboard').classList.add('hidden');
}

function assertConfigured() {
  if (!config.cognitoDomain || !config.clientId)
    throw new Error('Dashboard configuration is missing.');
}

function escapeHtml(value) {
  const span = document.createElement('span');
  span.textContent = value;
  return span.innerHTML;
}
