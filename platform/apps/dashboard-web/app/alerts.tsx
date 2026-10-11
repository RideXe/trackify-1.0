'use client';

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type {
  AlertRule,
  Device,
  Driver,
  FleetAlert,
  FleetEvent,
  TrackifyClient,
} from '@trackify/api-client';
import { BellRing, CheckCircle2, Gauge, MapPin, Siren } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SPEED_RULE_NAME, parseSpeedLimit, speedingEpisodes, speedingNow } from './alerts-data';
import { alertTitle, mapLink } from './driver-activity-data';
import { clockTime, timeAgo } from './fleet-map-data';
import { durationLabel } from './fleet-views-data';
import { Panel, PanelHead, rowDivider } from './panel';

const severityColors: Record<FleetAlert['severity'], string> = {
  critical: '#D92D20',
  high: '#DC6803',
  warning: '#B54708',
};

/** Shown on every page while an SOS is unacknowledged, so it cannot be missed. */
export function SosBanner({
  alerts,
  onOpenAlerts,
  onOpenVehicle,
}: {
  alerts: FleetAlert[];
  onOpenAlerts: () => void;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const open = alerts.filter((alert) => alert.status === 'open' && alert.severity === 'critical');
  if (!open.length) return null;
  const [latest] = open;
  return (
    <Alert
      severity="error"
      variant="filled"
      icon={<Siren />}
      sx={{ mb: 3, alignItems: 'center' }}
      action={
        <Stack direction="row" spacing={1}>
          <Button color="inherit" size="small" onClick={() => onOpenVehicle(latest!.deviceId)}>
            Open vehicle
          </Button>
          <Button color="inherit" size="small" variant="outlined" onClick={onOpenAlerts}>
            All alerts
          </Button>
        </Stack>
      }
    >
      <strong>
        {open.length === 1 ? 'SOS' : `${open.length} SOS alerts`} · {latest!.deviceName}
      </strong>{' '}
      {timeAgo(latest!.createdAt)}. Contact the driver now.
    </Alert>
  );
}

type AlertsTab = 'live' | 'history' | 'limits';

/**
 * Everything that needs attention, in three tabs: what is happening now (vehicles speeding, SOS
 * and driver reports), every time a vehicle went over its limit, and the limits themselves with
 * how administrators are told.
 */
export function AlertsPage({
  alerts,
  error,
  admin,
  canAcknowledge,
  client,
  devices,
  drivers,
  onChanged,
  onDevicesChanged,
  onOpenVehicle,
}: {
  /** Undefined while loading. */
  alerts?: FleetAlert[];
  error: string;
  admin: boolean;
  canAcknowledge: boolean;
  client: TrackifyClient;
  devices: Device[];
  drivers?: Driver[];
  onChanged: () => Promise<void>;
  onDevicesChanged: () => Promise<void>;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [tab, setTab] = useState<AlertsTab>('live');
  const speeding = speedingNow(devices);
  const openReports = (alerts ?? []).filter((alert) => alert.status === 'open').length;
  const live = speeding.length + openReports;
  const driverName = useCallback(
    (driverId?: string) =>
      driverId ? (drivers?.find((driver) => driver.driverId === driverId)?.name ?? '—') : '—',
    [drivers],
  );

  return (
    <Stack spacing={2}>
      <Paper sx={{ px: 1 }}>
        <Tabs
          value={tab}
          onChange={(_, value: AlertsTab) => setTab(value)}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          <Tab
            value="live"
            label={live ? `Live · ${live}` : 'Live'}
            sx={{ textTransform: 'none', fontWeight: 700, color: live ? 'error.main' : undefined }}
          />
          <Tab
            value="history"
            label="Speeding history"
            sx={{ textTransform: 'none', fontWeight: 700 }}
          />
          <Tab
            value="limits"
            label="Speed limits"
            sx={{ textTransform: 'none', fontWeight: 700 }}
          />
        </Tabs>
      </Paper>
      {tab === 'live' ? (
        <LiveTab
          alerts={alerts}
          canAcknowledge={canAcknowledge}
          client={client}
          driverName={driverName}
          error={error}
          speeding={speeding}
          onChanged={onChanged}
          onOpenVehicle={onOpenVehicle}
        />
      ) : tab === 'history' ? (
        <HistoryTab
          client={client}
          devices={devices}
          driverName={driverName}
          onOpenVehicle={onOpenVehicle}
        />
      ) : (
        <LimitsTab
          admin={admin}
          client={client}
          devices={devices}
          onDevicesChanged={onDevicesChanged}
        />
      )}
    </Stack>
  );
}

function LiveTab({
  alerts,
  error,
  canAcknowledge,
  client,
  speeding,
  driverName,
  onChanged,
  onOpenVehicle,
}: {
  alerts?: FleetAlert[];
  error: string;
  canAcknowledge: boolean;
  client: TrackifyClient;
  speeding: ReturnType<typeof speedingNow>;
  driverName: (driverId?: string) => string;
  onChanged: () => Promise<void>;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState('');
  const [actionError, setActionError] = useState('');
  const shown = (alerts ?? []).filter((alert) => filter === 'all' || alert.status === 'open');

  async function acknowledge(alert: FleetAlert) {
    setBusy(alert.alertId);
    setActionError('');
    try {
      await client.acknowledgeAlert(alert.alertId);
      await onChanged();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Alert could not be updated');
    } finally {
      setBusy('');
    }
  }

  return (
    <Stack spacing={2}>
      {speeding.length > 0 && (
        <Panel>
          <PanelHead
            icon={<Gauge size={18} color="#D92D20" />}
            section
            title={`Speeding now · ${speeding.length}`}
            caption="Over their speed limit at this moment. Updates live."
          />
          {speeding.map((item) => (
            <Stack
              key={item.device.deviceId}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{
                px: 2,
                py: 1.5,
                alignItems: { sm: 'center' },
                borderTop: `1px solid ${rowDivider}`,
                borderLeft: '4px solid #D92D20',
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 800 }}>
                  {item.device.name}{' '}
                  <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                    · driver {driverName(item.driverId)}
                  </Box>
                </Typography>
                <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                  <Box component="strong" sx={{ color: '#D92D20', fontSize: 15 }}>
                    {item.speedKmh} km/h now
                  </Box>
                  {item.maxSpeedKmh !== undefined && ` · top ${Math.round(item.maxSpeedKmh)} km/h`}
                  {item.speedLimitKmh !== undefined && ` · limit ${item.speedLimitKmh} km/h`}
                  {item.since !== undefined &&
                    ` · for ${durationLabel(Math.max(60_000, Date.now() - item.since))}`}
                </Typography>
              </Box>
              <Button
                onClick={() => onOpenVehicle(item.device.deviceId)}
                variant="contained"
                color="error"
              >
                View vehicle
              </Button>
            </Stack>
          ))}
        </Panel>
      )}

      <Panel>
        <PanelHead
          icon={<BellRing size={18} />}
          section
          title="Driver reports"
          caption="SOS, issues drivers reported, and phone problems that stop tracking."
          action={
            <ToggleButtonGroup
              exclusive
              size="small"
              value={filter}
              onChange={(_, value: 'open' | 'all' | null) => value && setFilter(value)}
            >
              <ToggleButton value="open">Open</ToggleButton>
              <ToggleButton value="all">All recent</ToggleButton>
            </ToggleButtonGroup>
          }
        />
        {error && (
          <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
            Alerts could not be loaded: {error}
          </Alert>
        )}
        {actionError && (
          <Alert severity="error" sx={{ mx: 2, mb: 2 }} onClose={() => setActionError('')}>
            {actionError}
          </Alert>
        )}
        {!alerts && !error ? (
          <Box sx={{ p: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : !shown.length ? (
          <Stack sx={{ alignItems: 'center', py: 5, borderTop: `1px solid ${rowDivider}` }}>
            <CheckCircle2 color="#079455" size={30} />
            <Typography sx={{ mt: 1, fontWeight: 700 }}>
              {filter === 'open' ? 'Nothing needs attention' : 'No recent reports'}
            </Typography>
          </Stack>
        ) : (
          shown.map((alert) => {
            const map = mapLink(alert.latitude, alert.longitude);
            return (
              <Stack
                key={alert.alertId}
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.5}
                sx={{
                  px: 2,
                  py: 1.5,
                  alignItems: { md: 'center' },
                  borderTop: `1px solid ${rowDivider}`,
                  borderLeft: 4,
                  borderLeftColor: severityColors[alert.severity],
                  opacity: alert.status === 'open' ? 1 : 0.65,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{alertTitle(alert)}</Typography>
                    <Chip
                      label={alert.deviceName}
                      onClick={() => onOpenVehicle(alert.deviceId)}
                      size="small"
                      variant="outlined"
                    />
                  </Stack>
                  <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                    {clockTime(alert.createdAt)} · {timeAgo(alert.createdAt)}
                    {alert.note ? ` · “${alert.note}”` : ''}
                    {alert.status === 'acknowledged' && alert.acknowledgedBy
                      ? ` · handled by ${alert.acknowledgedBy}`
                      : ''}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  {map && (
                    <Button
                      href={map}
                      rel="noreferrer"
                      size="small"
                      startIcon={<MapPin size={16} />}
                      target="_blank"
                    >
                      Map
                    </Button>
                  )}
                  {alert.status === 'open' && canAcknowledge && (
                    <Button
                      disabled={busy === alert.alertId}
                      onClick={() => void acknowledge(alert)}
                      size="small"
                      variant="contained"
                    >
                      Mark handled
                    </Button>
                  )}
                </Stack>
              </Stack>
            );
          })
        )}
      </Panel>
    </Stack>
  );
}

const periods = [
  { key: 'today', label: 'Today', from: () => new Date().setHours(0, 0, 0, 0) },
  { key: '7d', label: '7 days', from: () => Date.now() - 7 * 86_400_000 },
  { key: '30d', label: '30 days', from: () => Date.now() - 30 * 86_400_000 },
] as const;

function HistoryTab({
  client,
  devices,
  driverName,
  onOpenVehicle,
}: {
  client: TrackifyClient;
  devices: Device[];
  driverName: (driverId?: string) => string;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [period, setPeriod] = useState<(typeof periods)[number]['key']>('7d');
  const [vehicle, setVehicle] = useState('all');
  const [events, setEvents] = useState<FleetEvent[]>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setEvents(undefined);
    setError('');
    const from = periods.find((item) => item.key === period)!.from();
    client
      .fleetEvents(from, Date.now(), ['deviceOverspeed', 'overspeedEnded'], 2_000)
      .then((value) => active && setEvents(value.items))
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Speeding history unavailable');
      });
    return () => {
      active = false;
    };
  }, [client, period]);

  const episodes = useMemo(
    () =>
      speedingEpisodes(events ?? [], devices).filter(
        (episode) => vehicle === 'all' || episode.deviceId === vehicle,
      ),
    [events, devices, vehicle],
  );
  const worst = episodes.reduce<(typeof episodes)[number] | undefined>(
    (top, episode) => ((episode.maxSpeedKmh ?? 0) > (top?.maxSpeedKmh ?? 0) ? episode : top),
    undefined,
  );

  return (
    <Panel>
      <PanelHead
        icon={<Gauge size={18} />}
        section
        title="Speeding history"
        caption={
          events && episodes.length
            ? `${episodes.length} ${episodes.length === 1 ? 'time' : 'times'} over the limit${
                worst?.maxSpeedKmh
                  ? ` · fastest ${Math.round(worst.maxSpeedKmh)} km/h (${worst.deviceName})`
                  : ''
              }`
            : 'Every time a vehicle went over its speed limit.'
        }
        action={
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
          >
            <TextField
              select
              size="small"
              value={vehicle}
              onChange={(event) => setVehicle(event.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="all">All vehicles</MenuItem>
              {devices.map((device) => (
                <MenuItem key={device.deviceId} value={device.deviceId}>
                  {device.name}
                </MenuItem>
              ))}
            </TextField>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={period}
              onChange={(_, value: typeof period | null) => value && setPeriod(value)}
            >
              {periods.map((item) => (
                <ToggleButton key={item.key} value={item.key}>
                  {item.label}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Stack>
        }
      />
      {error && (
        <Alert severity="error" sx={{ mx: 2, mb: 2 }}>
          {error}
        </Alert>
      )}
      {!events && !error ? (
        <Box sx={{ p: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : !episodes.length ? (
        <Stack sx={{ alignItems: 'center', py: 5, borderTop: `1px solid ${rowDivider}` }}>
          <CheckCircle2 color="#079455" size={30} />
          <Typography sx={{ mt: 1, fontWeight: 700 }}>No speeding in this period</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            Vehicles need a speed limit for this to be recorded (Speed limits tab).
          </Typography>
        </Stack>
      ) : (
        <Box sx={{ overflowX: 'auto', borderTop: `1px solid ${rowDivider}` }}>
          <Table size="small" sx={{ minWidth: 720 }}>
            <TableHead>
              <TableRow
                sx={{
                  '& th': {
                    fontSize: 11,
                    fontWeight: 700,
                    color: 'text.secondary',
                    bgcolor: '#F8FAFC',
                  },
                }}
              >
                <TableCell>Vehicle</TableCell>
                <TableCell>Driver</TableCell>
                <TableCell align="right">Limit</TableCell>
                <TableCell align="right">Top speed</TableCell>
                <TableCell>When</TableCell>
                <TableCell>How long</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {episodes.map((episode) => {
                const map = mapLink(episode.latitude, episode.longitude);
                const over =
                  episode.maxSpeedKmh !== undefined && episode.speedLimitKmh !== undefined
                    ? Math.round(episode.maxSpeedKmh - episode.speedLimitKmh)
                    : undefined;
                return (
                  <TableRow key={episode.id} hover sx={{ '& td': { fontSize: 13 } }}>
                    <TableCell>
                      <Button
                        onClick={() => onOpenVehicle(episode.deviceId)}
                        size="small"
                        sx={{ fontWeight: 700, minWidth: 0, p: 0 }}
                      >
                        {episode.deviceName}
                      </Button>
                    </TableCell>
                    <TableCell>{driverName(episode.driverId)}</TableCell>
                    <TableCell align="right">
                      {episode.speedLimitKmh !== undefined ? `${episode.speedLimitKmh} km/h` : '—'}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: '#D92D20' }}>
                      {episode.maxSpeedKmh !== undefined
                        ? `${Math.round(episode.maxSpeedKmh)} km/h`
                        : '—'}
                      {over !== undefined && over > 0 && (
                        <Box
                          component="span"
                          sx={{ display: 'block', fontSize: 11, fontWeight: 600 }}
                        >
                          +{over} over
                        </Box>
                      )}
                    </TableCell>
                    <TableCell>{clockTime(episode.startTime)}</TableCell>
                    <TableCell>
                      {episode.ongoing ? (
                        <Chip color="error" label="Still speeding" size="small" />
                      ) : episode.durationS !== undefined ? (
                        durationLabel(Math.max(60_000, episode.durationS * 1000))
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {map && (
                        <Button
                          href={map}
                          rel="noreferrer"
                          size="small"
                          startIcon={<MapPin size={15} />}
                          target="_blank"
                        >
                          Map
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Panel>
  );
}

/** web = a pop-up in the dashboard; email = an email to each administrator. */
const deliveryOptions = [
  { channel: 'web', label: 'Show a pop-up in the dashboard' },
  { channel: 'email', label: 'Send an email' },
] as const;

function LimitsTab({
  admin,
  client,
  devices,
  onDevicesChanged,
}: {
  admin: boolean;
  client: TrackifyClient;
  devices: Device[];
  onDevicesChanged: () => Promise<void>;
}) {
  const [rule, setRule] = useState<AlertRule | null>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [everyLimit, setEveryLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();

  useEffect(() => {
    if (!admin) return;
    client
      .alertRules()
      .then(({ items }) =>
        setRule(
          items.find((item) => item.name === SPEED_RULE_NAME) ??
            items.find((item) => item.eventTypes.includes('deviceOverspeed')) ??
            null,
        ),
      )
      .catch(() => setRule(null));
  }, [admin, client]);

  /** The first limit also switches alerts on, so admins never have to set up a rule. */
  async function ensureRule() {
    if (rule) return;
    setRule(
      await client.createAlertRule({
        name: SPEED_RULE_NAME,
        enabled: true,
        eventTypes: ['deviceOverspeed'],
        deviceIds: [],
        groupIds: [],
        channels: ['web', 'email'],
        userIds: [],
      }),
    );
  }

  async function run(action: () => Promise<void>, done: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await action();
      await onDevicesChanged();
      setMessage({ ok: true, text: done });
    } catch (reason) {
      setMessage({ ok: false, text: reason instanceof Error ? reason.message : 'Not saved' });
    } finally {
      setBusy(false);
    }
  }

  async function saveLimit(device: Device, limit: number | null) {
    await run(
      async () => {
        await client.updateDevice(device.deviceId, { speedLimitKmh: limit });
        if (limit !== null) await ensureRule();
        setDrafts((current) => {
          const next = { ...current };
          delete next[device.deviceId];
          return next;
        });
      },
      limit === null
        ? `${device.name}: speed limit removed.`
        : `${device.name}: limit set to ${limit} km/h.`,
    );
  }

  async function saveEvery() {
    const limit = parseSpeedLimit(everyLimit);
    if (limit === undefined)
      return setMessage({ ok: false, text: 'Enter a speed from 5 to 300 km/h.' });
    await run(async () => {
      for (const device of devices)
        await client.updateDevice(device.deviceId, { speedLimitKmh: limit });
      await ensureRule();
      setDrafts({});
      setEveryLimit('');
    }, `Every vehicle's limit is now ${limit} km/h.`);
  }

  async function toggleChannel(channel: string, on: boolean) {
    if (!rule) return;
    const channels = on
      ? [...new Set([...rule.channels, channel])]
      : rule.channels.filter((item) => item !== channel);
    if (!channels.length)
      return setMessage({ ok: false, text: 'Keep at least one way of being told.' });
    setBusy(true);
    setMessage(undefined);
    try {
      setRule(await client.updateAlertRule(rule.ruleId, { channels, enabled: true }));
    } catch (reason) {
      setMessage({ ok: false, text: reason instanceof Error ? reason.message : 'Not saved' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack spacing={2} sx={{ maxWidth: 820 }}>
      {!admin && <Alert severity="info">Only administrators can change speed limits.</Alert>}
      {message && <Alert severity={message.ok ? 'success' : 'error'}>{message.text}</Alert>}

      {admin && (
        <Panel>
          <PanelHead
            icon={<BellRing size={18} />}
            section
            title="How you are told"
            caption="When a vehicle goes over its limit, every administrator is told straight away."
          />
          <Stack sx={{ px: 2, pb: 2 }}>
            {rule === undefined ? (
              <CircularProgress size={22} />
            ) : (
              <>
                {deliveryOptions.map(({ channel, label }) => (
                  <FormControlLabel
                    key={channel}
                    control={
                      <Checkbox
                        checked={rule ? rule.channels.includes(channel) : true}
                        disabled={busy || !rule}
                        onChange={(event) => void toggleChannel(channel, event.target.checked)}
                      />
                    }
                    label={label}
                  />
                ))}
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                  {rule
                    ? 'Emails go to the address each administrator signs in with.'
                    : 'Switched on automatically when you set the first speed limit.'}
                </Typography>
              </>
            )}
          </Stack>
        </Panel>
      )}

      <Panel>
        <PanelHead
          icon={<Gauge size={18} />}
          section
          title="Speed limits"
          caption="A vehicle going faster than its limit raises an alert. Leave a vehicle without a limit to never alert for it."
        />
        {admin && (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            sx={{ px: 2, pb: 2, alignItems: { sm: 'center' } }}
          >
            <Typography sx={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
              Same limit for every vehicle
            </Typography>
            <TextField
              disabled={busy}
              onChange={(event) => setEveryLimit(event.target.value)}
              placeholder="e.g. 60"
              size="small"
              value={everyLimit}
              sx={{ width: { sm: 140 } }}
              slotProps={{
                htmlInput: { inputMode: 'numeric' },
                input: { endAdornment: <InputAdornment position="end">km/h</InputAdornment> },
              }}
            />
            <Button
              disabled={busy || !everyLimit.trim()}
              onClick={() => void saveEvery()}
              variant="outlined"
            >
              Apply to all
            </Button>
          </Stack>
        )}
        {devices.map((device) => {
          const draft = drafts[device.deviceId];
          const value =
            draft ?? (device.speedLimitKmh !== undefined ? String(device.speedLimitKmh) : '');
          const parsed = parseSpeedLimit(value);
          const changed = draft !== undefined && parsed !== device.speedLimitKmh;
          return (
            <Stack
              key={device.deviceId}
              direction="row"
              spacing={1}
              sx={{ px: 2, py: 1.25, alignItems: 'center', borderTop: `1px solid ${rowDivider}` }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 700, fontSize: 14 }}>
                  {device.name}
                </Typography>
                <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                  {device.speedLimitKmh !== undefined
                    ? `Alerts above ${device.speedLimitKmh} km/h`
                    : 'No limit · no speeding alerts'}
                </Typography>
              </Box>
              <TextField
                disabled={!admin || busy}
                error={Boolean(draft) && parsed === undefined}
                onChange={(event) =>
                  setDrafts((current) => ({ ...current, [device.deviceId]: event.target.value }))
                }
                placeholder="No limit"
                size="small"
                value={value}
                sx={{ width: 120 }}
                slotProps={{
                  htmlInput: {
                    inputMode: 'numeric',
                    'aria-label': `Speed limit for ${device.name}`,
                  },
                  input: { endAdornment: <InputAdornment position="end">km/h</InputAdornment> },
                }}
              />
              {admin && changed && parsed !== undefined && (
                <Button
                  disabled={busy}
                  onClick={() => void saveLimit(device, parsed)}
                  variant="contained"
                >
                  Save
                </Button>
              )}
              {admin && !changed && device.speedLimitKmh !== undefined && (
                <Button
                  color="inherit"
                  disabled={busy}
                  onClick={() => void saveLimit(device, null)}
                >
                  Remove
                </Button>
              )}
            </Stack>
          );
        })}
      </Panel>
    </Stack>
  );
}
