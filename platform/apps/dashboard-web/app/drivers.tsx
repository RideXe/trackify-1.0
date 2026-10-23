'use client';

import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  IconButton,
  InputAdornment,
  Link,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  type Theme,
} from '@mui/material';
import {
  toVehicleType,
  type ActivityItem,
  type Device,
  type Driver,
  type TrackifyClient,
} from '@trackify/api-client';
import {
  BellRing,
  CalendarClock,
  CarFront,
  ClipboardCheck,
  Coffee,
  Ellipsis,
  Fuel,
  Gauge,
  IdCard,
  Pencil,
  Phone,
  Search,
  Siren,
  Smartphone,
  Trash2,
  TriangleAlert,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { SendAlertDialog } from './driver-activity';
import { describeActivity } from './driver-activity-data';
import {
  driverCounts,
  driverFilters,
  driverNow,
  driverScore,
  driverStateLabels,
  entriesFor,
  hoursLabel,
  listDrivers,
  speedingCount,
  weekStats,
  type DriverFilter,
  type DriverNow,
  type DriverScore,
  type DriverState,
  type WeekStats,
} from './driver-insights';
import { clockTime, timeAgo } from './fleet-map-data';
import { Panel, PanelHead, panelBorder, rowDivider } from './panel';
import { StatTile } from './stat-tile';
import {
  driverChanges,
  driverForm,
  driverFormError,
  driverInput,
  initials,
  telHref,
  type DriverForm,
} from './vehicle-data';
import { VehicleAvatar } from './vehicle-icons';

const WEEK_MS = 7 * 86_400_000;

const stateColors: Record<DriverState, string> = {
  unreachable: '#D92D20',
  'on-shift': '#079455',
  break: '#DC6803',
  'off-duty': '#667085',
  'no-vehicle': '#98A2B3',
};

const scoreColors: Record<DriverScore['label'], [string, string]> = {
  Good: ['#067647', '#ECFDF3'],
  Fair: ['#B54708', '#FFFAEB'],
  'Needs coaching': ['#B42318', '#FEF3F2'],
};

/**
 * The last seven days of driver-app entries and speeding events, for every vehicle at once:
 * drivers move between vehicles, so their week is spread across them.
 */
function useWeek(client: TrackifyClient, devices: Device[]) {
  const ids = devices.map((device) => device.deviceId).join(',');
  const [entries, setEntries] = useState<ActivityItem[]>();
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    const to = Date.now();
    const from = to - WEEK_MS;
    const list = ids ? ids.split(',') : [];
    try {
      const [activity, speeding] = await Promise.all([
        Promise.all(list.map((id) => client.activity(id, from, to))),
        // Speeding is optional: a vehicle without a speed limit simply has none.
        Promise.all(
          list.map((id) => client.events(id, from, to, 500).catch(() => ({ items: [] }))),
        ),
      ]);
      setEntries(activity.flatMap((result) => result.items));
      setEvents(speeding.flatMap((result) => result.items));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Weekly activity unavailable');
    }
  }, [client, ids]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  return { entries, events, error, reload: load };
}

function statsFor(
  driverId: string,
  entries: ActivityItem[] | undefined,
  events: Array<Record<string, unknown>>,
) {
  if (!entries) return undefined;
  const own = entriesFor(entries, driverId);
  return { own, stats: weekStats(own, speedingCount(events, driverId)) };
}

export function DriversPage({
  drivers,
  error,
  devices,
  admin,
  canMessage,
  client,
  onChanged,
  onRetry,
  onOpenVehicle,
}: {
  /** Undefined while loading. */
  drivers?: Driver[];
  error: string;
  devices: Device[];
  admin: boolean;
  /** Dispatchers and administrators can send alerts to drivers. */
  canMessage: boolean;
  client: TrackifyClient;
  onChanged: () => Promise<void>;
  onRetry: () => void;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [filter, setFilter] = useState<DriverFilter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Driver | 'new'>();
  const [profileId, setProfileId] = useState<string>();
  const [assigning, setAssigning] = useState<Driver>();
  const [alerting, setAlerting] = useState<{ driver: Driver; vehicle: Device }>();
  const [removeError, setRemoveError] = useState('');
  const week = useWeek(client, devices);

  const counts = useMemo(() => driverCounts(drivers ?? [], devices), [drivers, devices]);
  const rows = useMemo(
    () => listDrivers(drivers ?? [], devices, filter, query),
    [drivers, devices, filter, query],
  );
  const profile = drivers?.find((driver) => driver.driverId === profileId);

  async function remove(driver: Driver) {
    const vehicles = devices.filter((device) => device.driverId === driver.driverId);
    const unassigned = vehicles.length
      ? ` They will be taken off ${vehicles.map((vehicle) => vehicle.name).join(', ')}.`
      : '';
    if (!window.confirm(`Remove ${driver.name}?${unassigned} This cannot be undone.`)) return;
    setRemoveError('');
    try {
      await client.deleteDriver(driver.driverId);
      setProfileId(undefined);
      await onChanged();
    } catch (reason) {
      setRemoveError(reason instanceof Error ? reason.message : 'Driver could not be removed');
    }
  }

  const actions: DriverActions = {
    canMessage,
    admin,
    onAlert: (driver, vehicle) => setAlerting({ driver, vehicle }),
    onAssign: setAssigning,
    onEdit: setEditing,
    onRemove: (driver) => void remove(driver),
  };

  const tiles: Array<{ key: DriverFilter; icon: LucideIcon; tone: string }> = [
    { key: 'all', icon: Users, tone: '#155EEF' },
    { key: 'on-shift', icon: UserCheck, tone: '#079455' },
    { key: 'off-duty', icon: Coffee, tone: '#667085' },
    { key: 'no-vehicle', icon: UserX, tone: '#98A2B3' },
    { key: 'attention', icon: TriangleAlert, tone: counts.attention ? '#D92D20' : '#98A2B3' },
  ];

  return (
    <Stack spacing={2}>
      {error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          }
        >
          Drivers could not be loaded: {error}
        </Alert>
      )}
      {removeError && (
        <Alert severity="error" onClose={() => setRemoveError('')}>
          {removeError}
        </Alert>
      )}

      {!drivers ? (
        !error && (
          <Stack sx={{ alignItems: 'center', py: 8 }}>
            <CircularProgress size={28} />
          </Stack>
        )
      ) : !drivers.length ? (
        <EmptyDrivers admin={admin} onAdd={() => setEditing('new')} />
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
              gap: { xs: 0.75, sm: 1.5 },
            }}
          >
            {tiles.map(({ key, icon, tone }) => (
              <StatTile
                key={key}
                icon={icon}
                label={driverFilters[key]}
                selected={filter === key}
                tone={tone}
                value={counts[key]}
                onClick={() => setFilter(filter === key && key !== 'all' ? 'all' : key)}
              />
            ))}
          </Box>

          <Paper sx={{ overflow: 'hidden' }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ p: 2, alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
            >
              <TextField
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, phone or licence"
                size="small"
                value={query}
                sx={{ width: { sm: 340 } }}
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <Search size={17} />
                      </InputAdornment>
                    ),
                  },
                }}
              />
              {admin && (
                <Button
                  onClick={() => setEditing('new')}
                  startIcon={<UserPlus size={18} />}
                  variant="contained"
                >
                  Add driver
                </Button>
              )}
            </Stack>
            {week.error && (
              <Alert severity="warning" sx={{ mx: 2, mb: 1.5 }}>
                This week&apos;s hours and scores could not be loaded: {week.error}
              </Alert>
            )}
            <ListHeader />
            {!rows.length && (
              <Typography color="text.secondary" sx={{ p: 4, textAlign: 'center', fontSize: 13 }}>
                No drivers match.
              </Typography>
            )}
            {rows.map(({ driver, now }) => {
              const week7 = statsFor(driver.driverId, week.entries, week.events);
              return (
                <DriverRow
                  key={driver.driverId}
                  actions={actions}
                  driver={driver}
                  now={now}
                  stats={week7?.stats}
                  onOpen={() => setProfileId(driver.driverId)}
                  onOpenVehicle={onOpenVehicle}
                />
              );
            })}
          </Paper>
        </>
      )}

      <DriverProfile
        actions={actions}
        devices={devices}
        driver={profile}
        week={profile ? statsFor(profile.driverId, week.entries, week.events) : undefined}
        onClose={() => setProfileId(undefined)}
        onOpenVehicle={onOpenVehicle}
      />

      <AssignVehicleDialog
        client={client}
        devices={devices}
        driver={assigning}
        onClose={() => setAssigning(undefined)}
        onSaved={async () => {
          await onChanged();
          setAssigning(undefined);
        }}
      />

      {alerting && (
        <SendAlertDialog
          client={client}
          device={alerting.vehicle}
          driverName={alerting.driver.name}
          messages={(week.entries ?? [])
            .filter(
              (entry) => entry.type === 'message' && entry.deviceId === alerting.vehicle.deviceId,
            )
            .sort((a, b) => b.at - a.at)}
          open
          onClose={() => setAlerting(undefined)}
          onSent={week.reload}
        />
      )}

      <DriverDialog
        client={client}
        driver={editing === 'new' ? undefined : editing}
        open={Boolean(editing)}
        onClose={() => setEditing(undefined)}
        onSaved={async () => {
          await onChanged();
          setEditing(undefined);
        }}
      />
    </Stack>
  );
}

interface DriverActions {
  admin: boolean;
  canMessage: boolean;
  onAlert: (driver: Driver, vehicle: Device) => void;
  onAssign: (driver: Driver) => void;
  onEdit: (driver: Driver) => void;
  onRemove: (driver: Driver) => void;
}

function EmptyDrivers({ admin, onAdd }: { admin: boolean; onAdd: () => void }) {
  return (
    <Paper sx={{ p: { xs: 3, sm: 6 } }}>
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Avatar sx={{ width: 64, height: 64, bgcolor: '#EEF4FF', color: 'primary.main' }}>
          <IdCard size={30} />
        </Avatar>
        <Box>
          <Typography variant="h5">No drivers yet</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 460 }}>
            {admin
              ? 'Add the people who drive your vehicles with their phone and licence number, then give each one a vehicle.'
              : 'An administrator has not added any drivers yet.'}
          </Typography>
        </Box>
        {admin && (
          <Button onClick={onAdd} startIcon={<UserPlus size={18} />} variant="contained">
            Add your first driver
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

/** Driver · Status · Vehicle · This week · Score · actions; one card per driver on phones. */
const rowColumns = {
  xs: '1fr auto',
  md: 'minmax(200px, 1.4fr) minmax(150px, 1fr) minmax(120px, 0.9fr) minmax(120px, 0.9fr) 130px 112px',
};

function ListHeader() {
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'grid' },
        gridTemplateColumns: rowColumns.md,
        gap: 2,
        px: 2.5,
        py: 1,
        bgcolor: '#F8FAFC',
        borderTop: `1px solid ${panelBorder}`,
        borderBottom: `1px solid ${panelBorder}`,
        '& > *': {
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.4px',
          textTransform: 'uppercase',
          color: 'text.secondary',
        },
      }}
    >
      <span>Driver</span>
      <span>Status</span>
      <span>Vehicle</span>
      <span>Last 7 days</span>
      <span>Score</span>
      <span />
    </Box>
  );
}

function StateBadge({ now }: { now: DriverNow }) {
  const color = stateColors[now.state];
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          fontSize: 13,
          fontWeight: 700,
          color,
        }}
      >
        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
        {driverStateLabels[now.state]}
      </Box>
      {now.since && now.state !== 'off-duty' && now.state !== 'no-vehicle' && (
        <Typography color="text.secondary" sx={{ fontSize: 11 }}>
          since {clockTime(now.since)}
        </Typography>
      )}
    </Box>
  );
}

function ScoreBadge({ score, loading }: { score?: DriverScore; loading: boolean }) {
  if (loading) return <CircularProgress size={14} />;
  if (!score)
    return (
      <Typography color="text.secondary" sx={{ fontSize: 12 }}>
        No shifts yet
      </Typography>
    );
  const [color, background] = scoreColors[score.label];
  return (
    <Tooltip
      title={
        score.reasons.length
          ? score.reasons.map((reason) => `−${reason.points}: ${reason.text}`).join(' · ')
          : 'A clean week'
      }
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 0.6,
          px: 1,
          py: 0.35,
          borderRadius: '8px',
          bgcolor: background,
          color,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: 'nowrap',
        }}
      >
        {score.label}
        <Box component="span" sx={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
          {score.value}
        </Box>
      </Box>
    </Tooltip>
  );
}

function DriverRow({
  driver,
  now,
  stats,
  actions,
  onOpen,
  onOpenVehicle,
}: {
  driver: Driver;
  now: DriverNow;
  stats?: WeekStats;
  actions: DriverActions;
  onOpen: () => void;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const score = stats && driverScore(stats);
  return (
    <ListItemButton
      onClick={onOpen}
      sx={{
        display: 'grid',
        gridTemplateColumns: rowColumns,
        alignItems: 'center',
        gap: { xs: 1, md: 2 },
        px: { xs: 2, md: 2.5 },
        py: 1.5,
        borderBottom: `1px solid ${rowDivider}`,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
        <DriverAvatar name={driver.name} />
        <Box sx={{ minWidth: 0 }}>
          <Typography noWrap sx={{ fontWeight: 700, fontSize: 14 }}>
            {driver.name}
          </Typography>
          <Typography noWrap color="text.secondary" sx={{ fontSize: 12 }}>
            {driver.phone ?? 'No phone number'}
          </Typography>
          {/* Phones: status, vehicle and score under the name. */}
          <Stack
            direction="row"
            sx={{ display: { xs: 'flex', md: 'none' }, mt: 0.75, gap: 1, flexWrap: 'wrap' }}
          >
            <StateBadge now={now} />
            <ScoreBadge loading={!stats} score={score} />
          </Stack>
        </Box>
      </Stack>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <StateBadge now={now} />
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'block' }, minWidth: 0 }}>
        {now.vehicle ? (
          <Chip
            icon={<CarFront size={14} />}
            label={
              now.vehicles.length > 1
                ? `${now.vehicle.name} +${now.vehicles.length - 1}`
                : now.vehicle.name
            }
            onClick={(event) => {
              event.stopPropagation();
              onOpenVehicle(now.vehicle!.deviceId);
            }}
            size="small"
            variant="outlined"
            sx={{ maxWidth: '100%' }}
          />
        ) : (
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>
            —
          </Typography>
        )}
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        {stats ? (
          <>
            <Typography sx={{ fontSize: 13, fontWeight: 650 }}>
              {stats.shiftMs ? hoursLabel(stats.shiftMs) : '0 h'}
            </Typography>
            <Typography color="text.secondary" sx={{ fontSize: 11 }}>
              {stats.shifts} {stats.shifts === 1 ? 'shift' : 'shifts'}
            </Typography>
          </>
        ) : (
          <CircularProgress size={14} />
        )}
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'block' } }}>
        <ScoreBadge loading={!stats} score={score} />
      </Box>
      <Box onClick={(event) => event.stopPropagation()} sx={{ justifySelf: 'end' }}>
        <QuickActions actions={actions} driver={driver} now={now} />
      </Box>
    </ListItemButton>
  );
}

function QuickActions({
  driver,
  now,
  actions,
}: {
  driver: Driver;
  now: DriverNow;
  actions: DriverActions;
}) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <Stack direction="row" spacing={0.25}>
      {driver.phone && (
        <Tooltip title={`Call ${driver.name}`}>
          <IconButton aria-label={`Call ${driver.name}`} href={telHref(driver.phone)} size="small">
            <Phone size={17} />
          </IconButton>
        </Tooltip>
      )}
      {actions.canMessage && now.vehicle && (
        <Tooltip title="Send alert">
          <IconButton
            aria-label={`Send an alert to ${driver.name}`}
            onClick={() => actions.onAlert(driver, now.vehicle!)}
            size="small"
          >
            <BellRing size={17} />
          </IconButton>
        </Tooltip>
      )}
      {actions.admin && (
        <>
          <Tooltip title="More">
            <IconButton
              aria-label={`More for ${driver.name}`}
              onClick={(event) => setMenu(event.currentTarget)}
              size="small"
            >
              <Ellipsis size={17} />
            </IconButton>
          </Tooltip>
          <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
            <MenuItem
              onClick={() => {
                setMenu(null);
                actions.onAssign(driver);
              }}
              sx={{ gap: 1.25, fontSize: 13 }}
            >
              <CarFront size={16} /> {now.vehicle ? 'Change vehicle' : 'Give a vehicle'}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenu(null);
                actions.onEdit(driver);
              }}
              sx={{ gap: 1.25, fontSize: 13 }}
            >
              <Pencil size={16} /> Edit details
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMenu(null);
                actions.onRemove(driver);
              }}
              sx={{ gap: 1.25, fontSize: 13, color: 'error.main' }}
            >
              <Trash2 size={16} /> Remove driver
            </MenuItem>
          </Menu>
        </>
      )}
    </Stack>
  );
}

/** One driver in full: live status, the week in numbers, the score and why, and their log. */
function DriverProfile({
  driver,
  devices,
  week,
  actions,
  onClose,
  onOpenVehicle,
}: {
  driver?: Driver;
  devices: Device[];
  week?: { own: ActivityItem[]; stats: WeekStats };
  actions: DriverActions;
  onClose: () => void;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'));
  const now = driver && driverNow(driver, devices);
  const score = week && driverScore(week.stats);
  const log = (week?.own ?? [])
    .filter((entry) => entry.type !== 'message')
    .sort((a, b) => b.at - a.at)
    .slice(0, 40);
  const driven = [...new Set((week?.own ?? []).map((entry) => entry.deviceId))]
    .map((id) => devices.find((device) => device.deviceId === id))
    .filter((device): device is Device => Boolean(device));

  return (
    <Drawer
      anchor={phone ? 'bottom' : 'right'}
      open={Boolean(driver)}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width: { sm: 520 },
            maxHeight: { xs: '92dvh', sm: '100%' },
            borderTopLeftRadius: { xs: 16, sm: 0 },
            borderTopRightRadius: { xs: 16, sm: 0 },
            bgcolor: '#F5F7FB',
          },
        },
      }}
    >
      {driver && now && (
        <Stack spacing={2} sx={{ p: 2 }}>
          <Panel>
            <Box
              sx={{
                p: 2,
                color: '#FFFFFF',
                background: 'linear-gradient(120deg, #2563EB 0%, #3B82F6 60%, #60A5FA 100%)',
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <Avatar
                  sx={{
                    width: 48,
                    height: 48,
                    bgcolor: 'rgba(15, 42, 120, 0.45)',
                    fontWeight: 800,
                  }}
                >
                  {initials(driver.name)}
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontWeight: 800, fontSize: 19 }}>
                    {driver.name}
                  </Typography>
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.75,
                      mt: 0.5,
                      px: 1,
                      py: 0.3,
                      borderRadius: '20px',
                      bgcolor: 'rgba(255,255,255,0.18)',
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: stateColors[now.state],
                        boxShadow: '0 0 0 2px rgba(255,255,255,0.6)',
                      }}
                    />
                    {driverStateLabels[now.state]}
                    {now.since && now.state !== 'off-duty' && ` · since ${clockTime(now.since)}`}
                  </Box>
                </Box>
                <IconButton
                  aria-label="Close"
                  onClick={onClose}
                  sx={{ color: '#FFFFFF', alignSelf: 'flex-start' }}
                >
                  <X size={18} />
                </IconButton>
              </Stack>
            </Box>
            <Box sx={{ px: 2, py: 1 }}>
              <Detail label="Phone" value={driver.phone} />
              <Detail label="Licence number" value={driver.licenceNumber} />
              <Detail
                label="Vehicle"
                value={
                  now.vehicles.length ? (
                    <Stack
                      direction="row"
                      sx={{ gap: 0.5, flexWrap: 'wrap', justifyContent: 'flex-end' }}
                    >
                      {now.vehicles.map((vehicle) => (
                        <Link
                          key={vehicle.deviceId}
                          component="button"
                          onClick={() => onOpenVehicle(vehicle.deviceId)}
                          underline="hover"
                          sx={{ fontSize: 12, fontWeight: 650 }}
                        >
                          {vehicle.name}
                        </Link>
                      ))}
                    </Stack>
                  ) : undefined
                }
              />
            </Box>
            <Stack direction="row" spacing={1} sx={{ px: 2, pb: 2 }}>
              {driver.phone && (
                <Button
                  color="success"
                  fullWidth
                  href={telHref(driver.phone)}
                  startIcon={<Phone size={16} />}
                  variant="contained"
                >
                  Call
                </Button>
              )}
              {actions.canMessage && now.vehicle && (
                <Button
                  fullWidth
                  onClick={() => actions.onAlert(driver, now.vehicle!)}
                  startIcon={<BellRing size={16} />}
                  variant="outlined"
                >
                  Send alert
                </Button>
              )}
              {actions.admin && (
                <Button
                  fullWidth
                  onClick={() => actions.onAssign(driver)}
                  startIcon={<CarFront size={16} />}
                  variant="outlined"
                >
                  {now.vehicle ? 'Change vehicle' : 'Give a vehicle'}
                </Button>
              )}
            </Stack>
          </Panel>

          <Panel>
            <PanelHead
              icon={<CalendarClock size={18} />}
              title="Last 7 days"
              caption="From the driver app, across every vehicle they drove"
            />
            {!week ? (
              <Box sx={{ px: 2, pb: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 1,
                  px: 2,
                  pb: 2,
                }}
              >
                <Figure label="On shift" value={hoursLabel(week.stats.shiftMs)} />
                <Figure label="Shifts" value={String(week.stats.shifts)} />
                <Figure label="Breaks" value={hoursLabel(week.stats.breakMs)} />
                <Figure
                  icon={ClipboardCheck}
                  label="Vehicle checks"
                  value={`${week.stats.checkedShifts} of ${week.stats.shifts}`}
                />
                <Figure icon={Gauge} label="Speeding" value={String(week.stats.speeding)} />
                <Figure icon={Fuel} label="Fuel entries" value={String(week.stats.fuel)} />
                <Figure icon={Siren} label="SOS" value={String(week.stats.sos)} />
                <Figure icon={TriangleAlert} label="Issues" value={String(week.stats.issues)} />
                <Figure
                  icon={Smartphone}
                  label="Phone problems"
                  value={String(week.stats.phoneProblems)}
                />
              </Box>
            )}
          </Panel>

          <Panel>
            <PanelHead
              icon={<Gauge size={18} />}
              title="Driver score"
              caption="Starts at 100; points come off for each problem this week"
            />
            <Box sx={{ px: 2, pb: 2 }}>
              {!week ? (
                <CircularProgress size={20} />
              ) : !score ? (
                <Typography color="text.secondary" sx={{ fontSize: 13 }}>
                  No shifts in the last 7 days, so there is nothing to score yet.
                </Typography>
              ) : (
                <>
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1.5 }}>
                    <Typography
                      sx={{ fontSize: 32, fontWeight: 800, color: scoreColors[score.label][0] }}
                    >
                      {score.value}
                    </Typography>
                    <ScoreBadge loading={false} score={score} />
                  </Stack>
                  {score.reasons.length ? (
                    score.reasons.map((reason) => (
                      <Stack
                        key={reason.text}
                        direction="row"
                        sx={{
                          justifyContent: 'space-between',
                          py: 0.75,
                          fontSize: 13,
                          borderTop: `1px solid ${rowDivider}`,
                        }}
                      >
                        <span>{reason.text}</span>
                        <Box component="span" sx={{ color: 'error.main', fontWeight: 700 }}>
                          −{reason.points}
                        </Box>
                      </Stack>
                    ))
                  ) : (
                    <Typography color="success.main" sx={{ fontSize: 13, fontWeight: 650 }}>
                      A clean week: no speeding, every shift checked, no phone problems.
                    </Typography>
                  )}
                </>
              )}
            </Box>
          </Panel>

          {driven.length > 0 && (
            <Panel>
              <PanelHead icon={<CarFront size={18} />} title="Vehicles driven this week" />
              <List disablePadding sx={{ pb: 1 }}>
                {driven.map((vehicle) => (
                  <ListItemButton
                    key={vehicle.deviceId}
                    onClick={() => onOpenVehicle(vehicle.deviceId)}
                    sx={{ gap: 1.5, px: 2 }}
                  >
                    <VehicleAvatar
                      type={toVehicleType(vehicle.vehicleType)}
                      color="#155EEF"
                      background="#EEF4FF"
                      size={32}
                    />
                    <ListItemText primary={vehicle.name} />
                  </ListItemButton>
                ))}
              </List>
            </Panel>
          )}

          <Panel>
            <PanelHead icon={<CalendarClock size={18} />} title="Recent activity" />
            {!week ? (
              <Box sx={{ px: 2, pb: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : !log.length ? (
              <Typography color="text.secondary" sx={{ px: 2, pb: 2, fontSize: 13 }}>
                Nothing in the last 7 days.
              </Typography>
            ) : (
              log.map((entry) => {
                const { title, detail } = describeActivity(entry);
                const vehicle = devices.find((device) => device.deviceId === entry.deviceId);
                return (
                  <Stack
                    key={entry.entryId}
                    direction="row"
                    spacing={1.5}
                    sx={{ px: 2, py: 1.1, borderTop: `1px solid ${rowDivider}` }}
                  >
                    <Typography
                      color="text.secondary"
                      sx={{ width: 76, flexShrink: 0, fontSize: 11, pt: 0.2 }}
                    >
                      {timeAgo(entry.at)}
                    </Typography>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: 650 }}>{title}</Typography>
                      <Typography color="text.secondary" sx={{ fontSize: 12 }}>
                        {[detail, vehicle?.name].filter(Boolean).join(' · ')}
                      </Typography>
                    </Box>
                  </Stack>
                );
              })
            )}
          </Panel>

          {actions.admin && (
            <Stack direction="row" spacing={1}>
              <Button
                color="inherit"
                fullWidth
                onClick={() => actions.onEdit(driver)}
                startIcon={<Pencil size={16} />}
              >
                Edit details
              </Button>
              <Button
                color="error"
                fullWidth
                onClick={() => actions.onRemove(driver)}
                startIcon={<Trash2 size={16} />}
              >
                Remove driver
              </Button>
            </Stack>
          )}
        </Stack>
      )}
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      sx={{
        justifyContent: 'space-between',
        alignItems: 'center',
        py: 0.9,
        '& + &': { borderTop: `1px solid ${rowDivider}` },
      }}
    >
      <Typography sx={{ fontSize: 12, color: '#6D788C' }}>{label}</Typography>
      {value ? (
        typeof value === 'string' ? (
          <Typography sx={{ fontSize: 12, fontWeight: 650 }}>{value}</Typography>
        ) : (
          value
        )
      ) : (
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>
          Not set
        </Typography>
      )}
    </Stack>
  );
}

function Figure({ label, value, icon: Icon }: { label: string; value: string; icon?: LucideIcon }) {
  return (
    <Box
      sx={{
        p: 1.25,
        borderRadius: '10px',
        border: `1px solid ${panelBorder}`,
        bgcolor: '#FBFCFE',
        minWidth: 0,
      }}
    >
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
        {Icon && <Icon size={13} />}
        <Typography noWrap sx={{ fontSize: 11 }}>
          {label}
        </Typography>
      </Stack>
      <Typography sx={{ fontSize: 16, fontWeight: 800, mt: 0.25 }}>{value}</Typography>
    </Box>
  );
}

/** Puts a driver on a vehicle; a vehicle has one driver, so its current one is replaced. */
function AssignVehicleDialog({
  driver,
  devices,
  client,
  onClose,
  onSaved,
}: {
  driver?: Driver;
  devices: Device[];
  client: TrackifyClient;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setError(''), [driver]);

  async function assign(vehicle: Device) {
    if (!driver) return;
    setBusy(vehicle.deviceId);
    setError('');
    try {
      await client.updateDevice(vehicle.deviceId, { driverId: driver.driverId });
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vehicle could not be assigned');
    } finally {
      setBusy('');
    }
  }

  return (
    <Dialog open={Boolean(driver)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle component="div">
        <Typography component="h2" sx={{ fontSize: 18, fontWeight: 800 }}>
          Choose a vehicle for {driver?.name}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          A vehicle has one driver. Picking one that already has a driver replaces them.
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        <List disablePadding>
          {devices.map((vehicle) => {
            const mine = vehicle.driverId === driver?.driverId;
            return (
              <ListItemButton
                key={vehicle.deviceId}
                disabled={Boolean(busy) || mine}
                onClick={() => void assign(vehicle)}
                sx={{ gap: 1.5, px: 2.5 }}
              >
                <VehicleAvatar
                  type={toVehicleType(vehicle.vehicleType)}
                  color="#155EEF"
                  background="#EEF4FF"
                  size={34}
                />
                <ListItemText
                  primary={vehicle.name}
                  secondary={
                    mine ? 'Already theirs' : vehicle.driverId ? 'Has another driver' : 'No driver'
                  }
                />
                {busy === vehicle.deviceId && <CircularProgress size={16} />}
              </ListItemButton>
            );
          })}
        </List>
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Initials rather than a photo: Trackify does not store driver photos. */
export function DriverAvatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: '#EEF4FF',
        color: 'primary.main',
        fontSize: size * 0.38,
        fontWeight: 700,
      }}
    >
      {initials(name)}
    </Avatar>
  );
}

export function DriverFields({
  form,
  disabled,
  onChange,
}: {
  form: DriverForm;
  disabled?: boolean;
  onChange: (form: DriverForm) => void;
}) {
  return (
    <Stack spacing={2}>
      <TextField
        autoFocus
        disabled={disabled}
        fullWidth
        label="Full name"
        onChange={(event) => onChange({ ...form, name: event.target.value })}
        required
        value={form.name}
        slotProps={{ htmlInput: { maxLength: 100 } }}
      />
      <TextField
        disabled={disabled}
        fullWidth
        label="Phone number"
        onChange={(event) => onChange({ ...form, phone: event.target.value })}
        type="tel"
        value={form.phone}
        slotProps={{ htmlInput: { maxLength: 20, inputMode: 'tel' } }}
      />
      <TextField
        disabled={disabled}
        fullWidth
        label="Driving licence number"
        onChange={(event) => onChange({ ...form, licenceNumber: event.target.value })}
        value={form.licenceNumber}
        slotProps={{ htmlInput: { maxLength: 40 } }}
      />
    </Stack>
  );
}

/** Adds a driver, or edits one when `driver` is given. */
export function DriverDialog({
  open,
  driver,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  driver?: Driver;
  client: TrackifyClient;
  onClose: () => void;
  onSaved: (driver: Driver) => Promise<void>;
}) {
  const [form, setForm] = useState(() => driverForm(driver));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setForm(driverForm(driver));
    setError('');
  }, [open, driver]);

  async function save() {
    const invalid = driverFormError(form);
    if (invalid) return setError(invalid);
    const changes = driver ? driverChanges(driver, form) : undefined;
    if (changes && !Object.keys(changes).length) return onClose();
    setBusy(true);
    setError('');
    try {
      const saved = driver
        ? await client.updateDriver(driver.driverId, changes!)
        : await client.createDriver(driverInput(form));
      await onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Driver could not be saved');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle component="div">
        <Typography component="h2" variant="h5">
          {driver ? 'Edit driver' : 'Add driver'}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Only the name is required. Leave anything you do not have blank.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <DriverFields form={form} disabled={busy} onChange={setForm} />
        </Box>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void save()} variant="contained">
          {busy ? 'Saving…' : driver ? 'Save changes' : 'Add driver'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
