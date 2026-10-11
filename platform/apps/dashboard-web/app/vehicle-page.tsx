'use client';

import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
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
  fuelTypes,
  toVehicleType,
  type Device,
  type Driver,
  type TrackifyClient,
} from '@trackify/api-client';
import {
  ArrowLeft,
  ArrowLeftRight,
  Bus,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  Clock3,
  Compass,
  Gauge,
  Milestone,
  Navigation,
  Link2,
  Route,
  Settings,
  type LucideIcon,
  Ellipsis,
  MapPin,
  MessageSquareText,
  Pencil,
  PhoneCall,
  Trash2,
  UserPlus,
  UserMinus,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityCard, PhoneSettingsDialog, SendAlertDialog, useActivity } from './driver-activity';
import { presence, type PresenceTone } from './driver-activity-data';
import { DriverAvatar, DriverFields } from './drivers';
import { FleetMap } from './fleet-map';
import {
  clockTime,
  headingLabel,
  noGpsSince,
  statusColors,
  timeAgo,
  vehicleStatus,
} from './fleet-map-data';
import { Panel, PanelHead, panelBorder, rowDivider, textButtonSx } from './panel';
import { RouteHistory } from './route-history';
import {
  assignedDriver,
  detailChanges,
  detailsForm,
  driverForm,
  driverFormError,
  driverInput,
  formatCalendarDay,
  fuelLabels,
  telHref,
  todayCalendarDay,
  vehiclesByDriver,
  type DetailsForm,
} from './vehicle-data';
import { VehicleAvatar, VehicleTypePicker, vehicleIcons } from './vehicle-icons';

interface Activity {
  trips: number;
  events: number;
  distanceKm: number;
}

/** The status dot on the blue header: the colour says what the words say. */
const dotColors: Record<PresenceTone, string> = {
  moving: '#4ADE80',
  parked: '#4ADE80',
  critical: '#F87171',
  warning: '#FBBF24',
  muted: '#CBD5E1',
};

const statIcons: Record<string, LucideIcon> = {
  'Last heard': CalendarClock,
  'Last position': Clock3,
  'Speed now': Gauge,
  Heading: Compass,
  'Distance today': MapPin,
  'This trip': Navigation,
  'Trips · 24 h': Route,
  'Events · 24 h': CalendarDays,
  Odometer: Milestone,
};

const kmNumber = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 });
const km = (value: number) => `${kmNumber(value)} km`;

/** Label, value and an optional unit shown smaller next to the value. */
type Stat = [label: string, value: string, unit?: string];

/**
 * One vehicle in full: live status and position, its driver, its details and route history.
 * Anything not recorded or entered is shown as missing, never estimated.
 */
export function VehiclePage({
  device,
  devices,
  drivers,
  driversError,
  admin,
  canDispatch,
  client,
  connection,
  onChanged,
  onDriversChanged,
  onRemoved,
}: {
  device: Device;
  devices: Device[];
  /** Undefined while loading. */
  drivers?: Driver[];
  driversError: string;
  admin: boolean;
  /** Dispatchers and administrators can message the driver and handle alerts. */
  canDispatch: boolean;
  client: TrackifyClient;
  /** The tracker pairing controls (they live with the setup-code flow), shown as a popup. */
  connection: (onClose: () => void) => ReactNode;
  onChanged: () => Promise<void>;
  onDriversChanged: () => Promise<void>;
  onRemoved: () => Promise<void>;
}) {
  const vehicleType = toVehicleType(device.vehicleType);
  const status = vehicleStatus(device);
  const state = device.state;
  const mapDevices = useMemo(() => [device], [device]);
  const [editOpen, setEditOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Route history fills the screen on phones; elsewhere it is a large popup.
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'));
  const activityLog = useActivity(client, device.deviceId);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [activity, setActivity] = useState<Activity>();

  useEffect(() => {
    let active = true;
    setActivity(undefined);
    const now = Date.now();
    Promise.all([
      client.trips(device.deviceId, now - 86_400_000, now),
      client.events(device.deviceId, now - 86_400_000, now),
      client.summary(device.deviceId),
    ])
      .then(([trips, events, summary]) => {
        if (!active) return;
        setActivity({
          trips: trips.items.length,
          events: events.items.length,
          distanceKm:
            summary.items.reduce((sum, item) => sum + Number(item.distanceM ?? 0), 0) / 1000,
        });
      })
      // Left as "—" rather than zero: zero would claim the vehicle did nothing.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [client, device.deviceId]);

  async function removeVehicle() {
    if (
      !window.confirm(
        `Remove ${device.name}? Its setup code stops working immediately. This cannot be undone.`,
      )
    )
      return;
    setRemoveBusy(true);
    setRemoveError('');
    try {
      await client.deleteDevice(device.deviceId);
      await onRemoved();
    } catch (reason) {
      setRemoveError(reason instanceof Error ? reason.message : 'Vehicle could not be removed');
      setRemoveBusy(false);
    }
  }

  const now = presence(device);
  const gpsLost = noGpsSince(device);
  // Offline, speed and heading say nothing: show when it was last heard from and last located.
  const live: Stat[] =
    status === 'offline'
      ? [
          ['Last heard', state?.lastSeenAt ? timeAgo(state.lastSeenAt) : 'Never'],
          ['Last position', state?.fixTime ? clockTime(state.fixTime) : 'None yet'],
        ]
      : [
          status === 'moving'
            ? ['Speed now', String(Math.round(state?.speedKmh ?? 0)), 'km/h']
            : ['Speed now', '0', 'km/h'],
          [
            'Heading',
            status === 'moving' && state?.courseDeg !== undefined
              ? headingLabel(state.courseDeg)
              : '—',
          ],
        ];
  const stats: Stat[] = [
    ...live,
    activity ? ['Distance today', kmNumber(activity.distanceKm), 'km'] : ['Distance today', '—'],
    ['Trips · 24 h', activity ? String(activity.trips) : '—'],
    ['Events · 24 h', activity ? String(activity.events) : '—'],
    state?.odometerM !== undefined
      ? ['Odometer', kmNumber(state.odometerM / 1000), 'km']
      : ['Odometer', '—'],
  ];
  if (state?.trip)
    stats.splice(2, 0, [
      'This trip',
      `${km(state.trip.distanceM / 1000)} · top ${Math.round(state.trip.maxSpeedKmh)} km/h`,
    ]);
  const hasPosition = Number.isFinite(state?.latitude) && Number.isFinite(state?.longitude);
  const coordinates = hasPosition
    ? `${state!.latitude!.toFixed(5)}, ${state!.longitude!.toFixed(5)}`
    : undefined;

  return (
    <Stack spacing={2}>
      <Panel>
        <Box
          sx={{
            position: 'relative',
            px: { xs: 1.75, sm: 2.25 },
            py: { xs: 1.4, sm: 1.6 },
            color: '#FFFFFF',
            background: 'linear-gradient(120deg, #2563EB 0%, #3B82F6 60%, #60A5FA 100%)',
          }}
        >
          <Stack direction="row" spacing={{ xs: 1.5, sm: 2 }} sx={{ alignItems: 'center' }}>
            <VehicleAvatar
              type={vehicleType}
              size={44}
              color="#FFFFFF"
              background="rgba(15, 42, 120, 0.45)"
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              {/* Name and status on one line keep the header short. */}
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
              >
                <Typography
                  component="h1"
                  noWrap
                  sx={{
                    fontSize: { xs: 18, sm: 20 },
                    fontWeight: 800,
                    letterSpacing: '-0.5px',
                    lineHeight: 1.2,
                    minWidth: 0,
                  }}
                >
                  {device.name}
                </Typography>
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.75,
                    px: 1.1,
                    py: 0.4,
                    borderRadius: '20px',
                    bgcolor: 'rgba(255, 255, 255, 0.18)',
                    fontSize: { xs: 11, sm: 12 },
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      bgcolor: dotColors[now.tone],
                      boxShadow: '0 0 0 2px rgba(255,255,255,0.5)',
                    }}
                  />
                  {now.label}
                </Box>
              </Stack>
              <Typography sx={{ mt: 0.4, fontSize: { xs: 11, sm: 12 }, opacity: 0.9 }}>
                {vehicleIcons[vehicleType].label}
                {device.model && (
                  <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                    {` · ${device.model}`}
                  </Box>
                )}
                {' · '}
                {state?.lastSeenAt
                  ? `last heard ${timeAgo(state.lastSeenAt)}`
                  : 'no update received yet'}
                {gpsLost !== undefined && ` · no GPS since ${clockTime(gpsLost)}`}
              </Typography>
            </Box>
            {admin && (
              <Tooltip title="Edit details">
                <IconButton
                  aria-label="Edit details"
                  onClick={() => setEditOpen(true)}
                  sx={{
                    alignSelf: 'center',
                    width: 34,
                    height: 34,
                    borderRadius: '12px',
                    color: '#FFFFFF',
                    bgcolor: 'rgba(255, 255, 255, 0.2)',
                    '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.3)' },
                  }}
                >
                  <Pencil size={18} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Box>
        <Box sx={{ px: { xs: 1.75, sm: 2.25 }, pb: { xs: 1.25, sm: 1.5 } }}>
          {removeError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {removeError}
            </Alert>
          )}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
                lg: `repeat(${stats.length}, minmax(0, 1fr))`,
              },
              gap: { xs: 1, sm: 1.25 },
              pt: { xs: 1.25, sm: 1.5 },
            }}
          >
            {stats.map(([label, value, unit]) => {
              const Icon = statIcons[label] ?? Gauge;
              return (
                <Panel
                  key={label}
                  sx={{
                    display: 'flex',
                    gap: 1.25,
                    alignItems: 'flex-start',
                    px: { xs: 1.5, sm: 1.75 },
                    py: { xs: 0.9, sm: 1 },
                    bgcolor: '#FBFCFE',
                  }}
                >
                  <Box sx={{ color: 'primary.main', display: 'flex', pt: 0.2, flexShrink: 0 }}>
                    <Icon size={18} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography color="text.secondary" sx={{ fontSize: 11, mb: 0.15 }}>
                      {label}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: { xs: 15, sm: 16 },
                        fontWeight: 800,
                        letterSpacing: '-0.4px',
                        lineHeight: 1.25,
                      }}
                    >
                      {value}
                      {unit && (
                        <Box
                          component="span"
                          sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', ml: 0.5 }}
                        >
                          {unit}
                        </Box>
                      )}
                    </Typography>
                  </Box>
                </Panel>
              );
            })}
          </Box>
        </Box>
      </Panel>

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          alignItems: 'start',
          // A main area (map and activity) and a column of vehicle cards on the right. Each
          // stacks on its own, so a tall column never leaves gaps in the other.
          gridTemplateColumns: {
            xs: '1fr',
            lg: 'minmax(0, 1fr) 300px',
            xl: 'minmax(0, 1fr) 340px',
          },
        }}
      >
        {/* On phones this wrapper dissolves, so its parts interleave with the vehicle cards. */}
        <Box
          sx={{
            display: { xs: 'contents', lg: 'flex' },
            flexDirection: 'column',
            gap: 2,
            minWidth: 0,
          }}
        >
          <Box
            sx={{
              order: 1,
              display: 'grid',
              gap: 2,
              // The map takes the spare width; the activity log stays a narrow column.
              gridTemplateColumns: {
                xs: '1fr',
                md: 'minmax(0, 1fr) 360px',
                xl: 'minmax(0, 1fr) 400px',
              },
              minWidth: 0,
            }}
          >
            <Panel>
              <PanelHead
                icon={<MapPin size={18} />}
                title="Live position"
                caption={
                  hasPosition
                    ? 'Last known location · updates as it moves'
                    : 'Waiting for the first GPS signal'
                }
                action={
                  <Stack direction="row" spacing={1}>
                    {/* Connect, replace or disconnect the phone or GPS unit. */}
                    <Button
                      onClick={() => setConnectionOpen(true)}
                      startIcon={<Link2 size={16} />}
                      variant="outlined"
                      sx={{ minHeight: 36, borderColor: '#BFD0FF' }}
                    >
                      {state?.lastSeenAt ? 'Connection' : 'Connect now'}
                    </Button>
                    <Button
                      onClick={() => setRouteOpen(true)}
                      startIcon={<Route size={16} />}
                      variant="contained"
                      sx={{ minHeight: 36 }}
                    >
                      Route history
                    </Button>
                  </Stack>
                }
              />
              <Box
                sx={{
                  position: 'relative',
                  borderTop: { xs: `1px solid ${panelBorder}`, lg: 0 },
                  // On desktop the map looks like the driver's phone screen rather than a wide panel.
                  mx: { lg: 2 },
                  p: { lg: '9px' },
                  bgcolor: { lg: '#172033' },
                  borderRadius: { lg: '30px' },
                  boxShadow: { lg: '0 10px 30px rgba(23,32,51,.18)' },
                  '& > div:first-of-type': { borderRadius: { lg: '22px' }, overflow: 'hidden' },
                }}
              >
                <FleetMap
                  devices={mapDevices}
                  height={{ xs: 340, sm: 420, lg: 600 }}
                  selectedId={device.deviceId}
                  onSelect={() => undefined}
                />
                {hasPosition && (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      position: 'absolute',
                      top: { xs: 9, sm: 12, lg: 21 },
                      left: { xs: 9, sm: 12, lg: 21 },
                      zIndex: 2,
                      alignItems: 'center',
                      bgcolor: '#FFFFFF',
                      border: `1px solid ${panelBorder}`,
                      borderRadius: '10px',
                      boxShadow: '0 2px 8px rgba(23,32,51,.06)',
                      px: { xs: 1.1, sm: 1.4 },
                      py: { xs: 0.9, sm: 1.1 },
                      fontSize: 11,
                      pointerEvents: 'none',
                    }}
                  >
                    <Box
                      sx={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        bgcolor: statusColors[status],
                      }}
                    />
                    <span>{status === 'moving' ? 'Live position' : 'Last known position'}</span>
                  </Stack>
                )}
              </Box>
              <Stack
                direction="row"
                spacing={1.25}
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  rowGap: 0.5,
                  px: { xs: 1.5, sm: 2 },
                  py: 1.4,
                  color: 'text.secondary',
                  fontSize: { xs: 10, sm: 11 },
                }}
              >
                <span>
                  <Box component="strong" sx={{ color: 'text.primary', fontWeight: 700 }}>
                    GPS coordinates
                  </Box>{' '}
                  · {coordinates ?? 'not received yet'}
                </span>
                {state?.lastSeenAt && <span>Updated {timeAgo(state.lastSeenAt)}</span>}
              </Stack>
            </Panel>
            {/* Beside the map the log is exactly as tall as the map and scrolls inside. */}
            <Box sx={{ position: 'relative', minWidth: 0, minHeight: { md: 420 } }}>
              <Box sx={{ position: { md: 'absolute' }, inset: 0, display: 'flex' }}>
                <ActivityCard
                  canMessage={canDispatch}
                  error={activityLog.error}
                  fill
                  items={activityLog.items}
                  onSendAlert={() => setAlertOpen(true)}
                />
              </Box>
            </Box>
          </Box>
        </Box>
        <Box
          sx={{
            order: 2,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: '1fr' },
            gap: 2,
            alignItems: 'start',
            minWidth: 0,
          }}
        >
          <DriverCard
            admin={admin}
            canMessage={canDispatch}
            onMessage={() => setAlertOpen(true)}
            client={client}
            device={device}
            devices={devices}
            drivers={drivers}
            driversError={driversError}
            onChanged={onChanged}
            onDriversChanged={onDriversChanged}
          />
          <DetailsCard
            admin={admin}
            device={device}
            onEdit={() => setEditOpen(true)}
            onPhoneSettings={() => setSettingsOpen(true)}
          />
        </Box>
      </Box>

      <Dialog
        open={routeOpen}
        onClose={() => setRouteOpen(false)}
        fullScreen={phone}
        fullWidth
        maxWidth="lg"
      >
        <RouteHistory client={client} device={device} onClose={() => setRouteOpen(false)} />
      </Dialog>

      {/* The card itself is the popup, so the dialog's own surface is hidden. */}
      <Dialog
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
        fullWidth
        maxWidth="xs"
        slotProps={{ paper: { sx: { bgcolor: 'transparent', boxShadow: 'none', m: 2 } } }}
      >
        {connection(() => setConnectionOpen(false))}
      </Dialog>

      <PhoneSettingsDialog
        admin={admin}
        client={client}
        device={device}
        open={settingsOpen}
        onChanged={onChanged}
        onClose={() => setSettingsOpen(false)}
      />

      <SendAlertDialog
        client={client}
        device={device}
        driverName={assignedDriver(device, drivers)?.name}
        messages={(activityLog.items ?? []).filter((item) => item.type === 'message')}
        open={alertOpen}
        onClose={() => setAlertOpen(false)}
        onSent={activityLog.reload}
      />

      <EditDetailsDialog
        client={client}
        device={device}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onRemove={admin ? () => void removeVehicle() : undefined}
        removeBusy={removeBusy}
        onSaved={async () => {
          await onChanged();
          setEditOpen(false);
        }}
      />
    </Stack>
  );
}

export function VehicleNotFound({ onBack }: { onBack: () => void }) {
  return (
    <Paper sx={{ p: { xs: 3, sm: 6 } }}>
      <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Typography variant="h5">This vehicle is not in your account</Typography>
        <Typography color="text.secondary">
          It may have been removed, or the link belongs to another workspace.
        </Typography>
        <Button onClick={onBack} startIcon={<ArrowLeft size={18} />} variant="contained">
          Back to all vehicles
        </Button>
      </Stack>
    </Paper>
  );
}

function DetailRow({
  label,
  value,
  missing = 'Not set',
}: {
  label: string;
  value?: string;
  missing?: string;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        py: 1,
        fontSize: 12,
        '& + &': { borderTop: `1px solid ${rowDivider}` },
      }}
    >
      <Typography sx={{ fontSize: 12, color: '#6D788C' }}>{label}</Typography>
      <Typography
        sx={{
          fontSize: 12,
          fontWeight: value ? 650 : 400,
          color: value ? 'text.primary' : 'text.secondary',
          textAlign: 'right',
          wordBreak: 'break-word',
        }}
      >
        {value ?? missing}
      </Typography>
    </Stack>
  );
}

function DetailsCard({
  device,
  admin,
  onEdit,
  onPhoneSettings,
}: {
  device: Device;
  admin: boolean;
  onEdit: () => void;
  /** Opens the driver phone settings (update interval, longest pause). */
  onPhoneSettings: () => void;
}) {
  const odometerM = device.state?.odometerM;
  return (
    <Panel>
      <PanelHead
        icon={<Bus size={18} />}
        title="Vehicle details"
        action={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            {device.protocol === 'osmand' && (
              <Tooltip title="Driver phone settings">
                <IconButton
                  aria-label="Driver phone settings"
                  onClick={onPhoneSettings}
                  size="small"
                >
                  <Settings size={17} />
                </IconButton>
              </Tooltip>
            )}
            {admin && (
              <Button
                onClick={onEdit}
                size="small"
                startIcon={<Pencil size={14} />}
                sx={textButtonSx}
              >
                Edit
              </Button>
            )}
          </Stack>
        }
      />
      <Box sx={{ px: { xs: 1.75, sm: 2 }, pb: 1.5, mt: -1 }}>
        <DetailRow label="Type" value={vehicleIcons[toVehicleType(device.vehicleType)].label} />
        <DetailRow label="Model" value={device.model} />
        <DetailRow label="Fuel" value={device.fuelType && fuelLabels[device.fuelType]} />
        <DetailRow
          label="Purchased on"
          value={device.purchasedOn && formatCalendarDay(device.purchasedOn)}
        />
        <DetailRow label="Colour" value={device.colour} />
        <DetailRow
          label="Odometer"
          value={odometerM !== undefined ? km(odometerM / 1000) : undefined}
          missing="No distance tracked yet"
        />
        <DetailRow label="GPS unit" value={device.uniqueId} />
        <DetailRow label="Protocol" value={device.protocol.toUpperCase()} />
      </Box>
    </Panel>
  );
}

function DriverCard({
  device,
  devices,
  drivers,
  driversError,
  admin,
  canMessage,
  client,
  onChanged,
  onDriversChanged,
  onMessage,
}: {
  device: Device;
  devices: Device[];
  drivers?: Driver[];
  driversError: string;
  admin: boolean;
  canMessage: boolean;
  /** Opens Send alert. */
  onMessage: () => void;
  client: TrackifyClient;
  onChanged: () => Promise<void>;
  onDriversChanged: () => Promise<void>;
}) {
  const driver = assignedDriver(device, drivers);
  const [assignOpen, setAssignOpen] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function assign(driverId: string | null) {
    setBusy(true);
    setError('');
    try {
      await client.updateDevice(device.deviceId, { driverId });
      await onChanged();
      setAssignOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Driver could not be assigned');
    } finally {
      setBusy(false);
    }
  }

  // Someone is assigned but the driver list has not arrived, so who it is is not known yet.
  const lookupPending = Boolean(device.driverId) && !drivers;

  return (
    <Panel>
      <PanelHead
        icon={<UserRound size={18} />}
        title="Assigned driver"
        action={
          admin &&
          driver && (
            <>
              <Tooltip title="More driver options">
                <IconButton
                  aria-label="More driver options"
                  onClick={(event) => setMenu(event.currentTarget)}
                  size="small"
                >
                  <Ellipsis size={18} />
                </IconButton>
              </Tooltip>
              <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
                <MenuItem
                  onClick={() => {
                    setMenu(null);
                    setAssignOpen(true);
                  }}
                  sx={{ gap: 1.25, fontSize: 13 }}
                >
                  <ArrowLeftRight size={16} /> Switch to another driver
                </MenuItem>
                <MenuItem
                  disabled={busy}
                  onClick={() => {
                    setMenu(null);
                    if (
                      window.confirm(
                        `Remove ${driver.name} from ${device.name}? The vehicle will have no driver until you assign one.`,
                      )
                    )
                      void assign(null);
                  }}
                  sx={{ gap: 1.25, fontSize: 13, color: 'error.main' }}
                >
                  <UserMinus size={16} /> Remove from this vehicle
                </MenuItem>
              </Menu>
            </>
          )
        }
      />
      <Box sx={{ px: { xs: 1.75, sm: 2 }, pb: { xs: 1.75, sm: 2 } }}>
        {driver ? (
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <DriverAvatar name={driver.name} size={42} />
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontWeight: 800 }}>
                  {driver.name}
                </Typography>
                <Typography color="text.secondary" sx={{ fontSize: 11 }}>
                  {driver.phone ?? 'No phone number entered'}
                </Typography>
              </Box>
            </Stack>
            <Box>
              <DetailRow label="Licence number" value={driver.licenceNumber} />
            </Box>
            <Stack direction="row" spacing={1}>
              {driver.phone && (
                <Button
                  fullWidth
                  href={telHref(driver.phone)}
                  startIcon={<PhoneCall size={16} />}
                  variant="contained"
                  color="success"
                  sx={{ minHeight: 38, fontSize: 12 }}
                >
                  Call driver
                </Button>
              )}
              {canMessage && (
                <Button
                  fullWidth
                  onClick={onMessage}
                  startIcon={<MessageSquareText size={16} />}
                  variant="outlined"
                  sx={{ minHeight: 38, fontSize: 12, borderColor: '#BFD0FF' }}
                >
                  Message
                </Button>
              )}
            </Stack>
            {admin && (
              <Button
                color="inherit"
                disabled={busy}
                endIcon={<ChevronRight size={17} />}
                fullWidth
                onClick={() => setAssignOpen(true)}
                startIcon={<ArrowLeftRight size={16} />}
                sx={{
                  justifyContent: 'flex-start',
                  minHeight: 42,
                  px: 1,
                  mx: -1,
                  width: 'calc(100% + 16px)',
                  color: '#39445A',
                  fontWeight: 650,
                  borderTop: `1px solid ${rowDivider}`,
                  borderRadius: 0,
                  '& .MuiButton-endIcon': { ml: 'auto' },
                }}
              >
                Switch driver
              </Button>
            )}
          </Stack>
        ) : lookupPending && !driversError ? (
          <CircularProgress size={22} />
        ) : lookupPending ? (
          <Typography color="text.secondary" variant="body2">
            A driver is assigned, but driver details could not be loaded.
          </Typography>
        ) : (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
              <Avatar sx={{ width: 42, height: 42, bgcolor: '#F2F4F7', color: '#98A2B3' }}>
                <UserRound size={22} />
              </Avatar>
              <Box>
                <Typography sx={{ fontWeight: 650 }}>No driver assigned</Typography>
                <Typography color="text.secondary" variant="body2">
                  {admin
                    ? 'Pick one of your drivers, or add a new one.'
                    : 'An administrator can assign a driver.'}
                </Typography>
              </Box>
            </Stack>
            {admin && (
              <Button
                onClick={() => setAssignOpen(true)}
                startIcon={<UserPlus size={17} />}
                variant="outlined"
              >
                Assign driver
              </Button>
            )}
          </Stack>
        )}
        {driversError && !lookupPending && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Drivers could not be loaded: {driversError}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
        <AssignDriverDialog
          busy={busy}
          client={client}
          device={device}
          devices={devices}
          drivers={drivers}
          driversError={driversError}
          error={error}
          open={assignOpen}
          onAssign={(driverId) => void assign(driverId)}
          onClose={() => setAssignOpen(false)}
          onDriversChanged={onDriversChanged}
        />
      </Box>
    </Panel>
  );
}

function AssignDriverDialog({
  open,
  device,
  devices,
  drivers,
  driversError,
  client,
  busy,
  error,
  onAssign,
  onClose,
  onDriversChanged,
}: {
  open: boolean;
  device: Device;
  devices: Device[];
  drivers?: Driver[];
  driversError: string;
  client: TrackifyClient;
  busy: boolean;
  error: string;
  onAssign: (driverId: string) => void;
  onClose: () => void;
  onDriversChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(() => driverForm());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const assignments = useMemo(() => vehiclesByDriver(devices), [devices]);
  useEffect(() => {
    if (!open) return;
    setAdding(drivers?.length === 0);
    setForm(driverForm());
    setCreateError('');
  }, [open, drivers?.length]);

  async function addAndAssign() {
    const invalid = driverFormError(form);
    if (invalid) return setCreateError(invalid);
    setCreating(true);
    setCreateError('');
    try {
      const created = await client.createDriver(driverInput(form));
      await onDriversChanged();
      onAssign(created.driverId);
    } catch (reason) {
      setCreateError(reason instanceof Error ? reason.message : 'Driver could not be added');
    } finally {
      setCreating(false);
    }
  }

  const working = busy || creating;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle component="div">
        <Typography component="h2" variant="h5">
          {adding ? 'Add a driver' : 'Assign a driver'}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {adding
            ? `They will be assigned to ${device.name} once added.`
            : `Choose who drives ${device.name}.`}
        </Typography>
      </DialogTitle>
      <DialogContent>
        {adding ? (
          <Box sx={{ pt: 1 }}>
            <DriverFields form={form} disabled={working} onChange={setForm} />
          </Box>
        ) : !drivers ? (
          driversError ? (
            <Alert severity="error">Drivers could not be loaded: {driversError}</Alert>
          ) : (
            <Stack sx={{ alignItems: 'center', py: 3 }}>
              <CircularProgress size={24} />
            </Stack>
          )
        ) : (
          <List disablePadding sx={{ mx: -1 }}>
            {drivers.map((driver) => {
              const elsewhere = (assignments.get(driver.driverId) ?? []).filter(
                (vehicle) => vehicle.deviceId !== device.deviceId,
              );
              const current = driver.driverId === device.driverId;
              return (
                <ListItemButton
                  key={driver.driverId}
                  disabled={working}
                  onClick={() => (current ? onClose() : onAssign(driver.driverId))}
                  selected={current}
                  sx={{ borderRadius: 2, gap: 1.5 }}
                >
                  <DriverAvatar name={driver.name} size={36} />
                  <ListItemText
                    primary={driver.name}
                    secondary={
                      [
                        current && 'Assigned now',
                        driver.phone,
                        elsewhere.length &&
                          `Also on ${elsewhere.map((vehicle) => vehicle.name).join(', ')}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || undefined
                    }
                    slotProps={{ primary: { sx: { fontWeight: 650 } } }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
        {(createError || error) && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {createError || error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, justifyContent: 'space-between' }}>
        {adding ? (
          <>
            <Button
              color="inherit"
              disabled={working}
              onClick={() => (drivers?.length ? setAdding(false) : onClose())}
            >
              {drivers?.length ? 'Back to list' : 'Cancel'}
            </Button>
            <Button disabled={working} onClick={() => void addAndAssign()} variant="contained">
              {working ? 'Saving…' : 'Add and assign'}
            </Button>
          </>
        ) : (
          <>
            <Button
              disabled={working || !drivers}
              onClick={() => setAdding(true)}
              startIcon={<UserPlus size={17} />}
            >
              Add a new driver
            </Button>
            <Button color="inherit" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function EditDetailsDialog({
  open,
  device,
  client,
  onClose,
  onRemove,
  removeBusy = false,
  onSaved,
}: {
  open: boolean;
  device: Device;
  client: TrackifyClient;
  onClose: () => void;
  /** Administrators only; kept here, away from Edit, so it is not clicked by accident. */
  onRemove?: () => void;
  removeBusy?: boolean;
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState<DetailsForm>(() => detailsForm(device));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Reset from the saved vehicle each time the dialog opens, not on every live position update.
  useEffect(() => {
    if (!open) return;
    setForm(detailsForm(device));
    setError('');
  }, [open]);

  async function save() {
    if (!form.name.trim()) return setError('Enter a vehicle name');
    const changes = detailChanges(device, form);
    if (!Object.keys(changes).length) return onClose();
    setBusy(true);
    setError('');
    try {
      await client.updateDevice(device.deviceId, changes);
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Details could not be saved');
    } finally {
      setBusy(false);
    }
  }

  const set = (changes: Partial<DetailsForm>) => setForm((current) => ({ ...current, ...changes }));
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle component="div">
        <Typography component="h2" variant="h5">
          Vehicle details
        </Typography>
        <Typography color="text.secondary" variant="body2">
          Everything except the name is optional. Leave blank what you do not know.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField
            disabled={busy}
            fullWidth
            label="Vehicle name"
            onChange={(event) => set({ name: event.target.value })}
            required
            value={form.name}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              Vehicle type
            </Typography>
            <VehicleTypePicker
              disabled={busy}
              value={form.vehicleType}
              onChange={(vehicleType) => set({ vehicleType })}
            />
          </Box>
          <TextField
            disabled={busy}
            fullWidth
            label="Make and model"
            onChange={(event) => set({ model: event.target.value })}
            placeholder="e.g. Toyota Innova Crysta 2.4 GX"
            value={form.model}
            slotProps={{ htmlInput: { maxLength: 100 } }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              disabled={busy}
              fullWidth
              label="Fuel"
              onChange={(event) => set({ fuelType: event.target.value as DetailsForm['fuelType'] })}
              select
              value={form.fuelType}
            >
              <MenuItem value="">
                <em>Not set</em>
              </MenuItem>
              {fuelTypes.map((fuelType) => (
                <MenuItem key={fuelType} value={fuelType}>
                  {fuelLabels[fuelType]}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              disabled={busy}
              fullWidth
              label="Purchased on"
              onChange={(event) => set({ purchasedOn: event.target.value })}
              type="date"
              value={form.purchasedOn}
              slotProps={{
                inputLabel: { shrink: true },
                htmlInput: { max: todayCalendarDay() },
              }}
            />
          </Stack>
          <TextField
            disabled={busy}
            fullWidth
            label="Colour"
            onChange={(event) => set({ colour: event.target.value })}
            value={form.colour}
            slotProps={{ htmlInput: { maxLength: 40 } }}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {onRemove && (
          <Button
            color="error"
            disabled={busy || removeBusy}
            onClick={onRemove}
            startIcon={<Trash2 size={16} />}
            sx={{ mr: 'auto' }}
          >
            {removeBusy ? 'Removing…' : 'Remove vehicle'}
          </Button>
        )}
        <Button color="inherit" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void save()} variant="contained">
          {busy ? 'Saving…' : 'Save details'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
