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
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  fuelTypes,
  toVehicleType,
  type Device,
  type Driver,
  type FleetAlert,
  type TrackifyClient,
} from '@trackify/api-client';
import {
  ArrowLeft,
  BellRing,
  LocateFixed,
  MapPin,
  Pencil,
  Phone,
  Trash2,
  TriangleAlert,
  UserPlus,
  UserRound,
  UserX,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DriverActivityCard, PhoneSettingsCard } from './driver-activity';
import { alertTitle, dutyLabel, mapLink, notReporting } from './driver-activity-data';
import { DriverAvatar, DriverFields } from './drivers';
import { FleetMap } from './fleet-map';
import {
  clockTime,
  headingLabel,
  noGpsSince,
  statusColors,
  statusLabels,
  timeAgo,
  vehicleStatus,
} from './fleet-map-data';
import { Panel, PanelHead, Pill, panelBorder, rowDivider, textButtonSx } from './panel';
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
  alerts,
  admin,
  canDispatch,
  client,
  connection,
  onBack,
  onChanged,
  onDriversChanged,
  onAlertsChanged,
  onRemoved,
}: {
  device: Device;
  devices: Device[];
  /** Undefined while loading. */
  drivers?: Driver[];
  driversError: string;
  /** The whole fleet's recent alerts; undefined while loading. */
  alerts?: FleetAlert[];
  admin: boolean;
  /** Dispatchers and administrators can message the driver and handle alerts. */
  canDispatch: boolean;
  client: TrackifyClient;
  /** The tracker pairing controls, which live with the rest of the setup-code flow. */
  connection: ReactNode;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onDriversChanged: () => Promise<void>;
  onAlertsChanged: () => Promise<void>;
  onRemoved: () => Promise<void>;
}) {
  const vehicleType = toVehicleType(device.vehicleType);
  const status = vehicleStatus(device);
  const state = device.state;
  const mapDevices = useMemo(() => [device], [device]);
  const [editOpen, setEditOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const [activity, setActivity] = useState<Activity>();
  const [focusRequest, setFocusRequest] = useState(0);

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

  const stats: Stat[] = [
    status === 'moving'
      ? ['Speed now', String(Math.round(state?.speedKmh ?? 0)), 'km/h']
      : status === 'parked'
        ? ['Speed now', '0', 'km/h']
        : ['Speed now', '—'],
    [
      'Heading',
      status === 'moving' && state?.courseDeg !== undefined ? headingLabel(state.courseDeg) : '—',
    ],
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
      <Box>
        <Button onClick={onBack} startIcon={<ArrowLeft size={18} />} sx={{ ml: -1 }}>
          All vehicles
        </Button>
      </Box>

      <Panel sx={{ p: { xs: 1.75, sm: 2.75 }, pb: { sm: 2.25 } }}>
        <Stack
          direction="row"
          spacing={{ xs: 1.25, sm: 1.75 }}
          sx={{ alignItems: { xs: 'flex-start', sm: 'center' }, flexWrap: 'wrap', rowGap: 1.5 }}
        >
          <VehicleAvatar
            type={vehicleType}
            size={48}
            color={statusColors[status]}
            background={`${statusColors[status]}1A`}
          />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack
              direction="row"
              spacing={1.1}
              sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
            >
              <Typography
                component="h1"
                noWrap
                sx={{
                  fontSize: { xs: 20, sm: 24 },
                  fontWeight: 800,
                  letterSpacing: '-0.8px',
                  lineHeight: 1.2,
                }}
              >
                {device.name}
              </Typography>
              <Pill color={statusColors[status]} background={`${statusColors[status]}1A`}>
                {statusLabels[status]}
              </Pill>
              {notReporting(device) ? (
                <Pill color="#D83A36" background="#FFF0EF">
                  ● On shift · phone not reachable
                  {state?.lastSeenAt ? ` since ${clockTime(state.lastSeenAt)}` : ''}
                </Pill>
              ) : noGpsSince(device) !== undefined ? (
                <Pill color="#B54708" background="#FFFAEB">
                  ● Phone online · no GPS signal since {clockTime(noGpsSince(device)!)}
                </Pill>
              ) : (
                dutyLabel(device) && (
                  <Pill color="#4B5568" background="#F0F2F6">
                    {dutyLabel(device)}
                  </Pill>
                )
              )}
            </Stack>
            <Typography color="text.secondary" sx={{ mt: 0.6, fontSize: { xs: 11, sm: 12 } }}>
              {[vehicleIcons[vehicleType].label, device.model].filter(Boolean).join(' · ')} ·{' '}
              {state?.lastSeenAt
                ? `last update ${timeAgo(state.lastSeenAt)}`
                : 'no GPS update received yet'}
            </Typography>
          </Box>
          {admin && (
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', width: { xs: '100%', sm: 'auto' } }}
            >
              <Button
                onClick={() => setEditOpen(true)}
                startIcon={<Pencil size={16} />}
                variant="outlined"
                sx={{ flex: { xs: 1, sm: 'none' }, minHeight: 38, borderColor: '#BFD0FF' }}
              >
                Edit details
              </Button>
              <Tooltip title="Remove vehicle">
                <IconButton
                  aria-label={`Remove ${device.name}`}
                  color="error"
                  disabled={removeBusy}
                  onClick={() => void removeVehicle()}
                  sx={{ border: '1px solid #F3D1CF', borderRadius: '10px', width: 39, height: 39 }}
                >
                  <Trash2 size={18} />
                </IconButton>
              </Tooltip>
            </Stack>
          )}
        </Stack>
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
            mt: { xs: 1.75, sm: 2.25 },
            pt: { xs: 1.6, sm: 2 },
            borderTop: `1px solid ${panelBorder}`,
          }}
        >
          {stats.map(([label, value, unit]) => (
            <Panel key={label} sx={{ px: { xs: 1.5, sm: 1.75 }, py: { xs: 1.4, sm: 1.6 } }}>
              <Typography color="text.secondary" sx={{ fontSize: 11, mb: 0.75 }}>
                {label}
              </Typography>
              <Typography
                sx={{
                  fontSize: { xs: 17, sm: 18 },
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
            </Panel>
          ))}
        </Box>
      </Panel>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            lg: 'minmax(0, 1fr) 300px',
            xl: 'minmax(0, 1fr) 320px',
          },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Panel>
            <PanelHead
              title="Live position"
              caption={
                hasPosition
                  ? 'Last known location · updates as it moves'
                  : 'Waiting for the first GPS signal'
              }
              action={
                <Button
                  disabled={!hasPosition}
                  onClick={() => setFocusRequest((value) => value + 1)}
                  startIcon={<LocateFixed size={16} />}
                  variant="outlined"
                  color="inherit"
                  sx={{ minHeight: 36, borderColor: '#DCE2EB', color: '#39445A' }}
                >
                  Center map
                </Button>
              }
            />
            <Box
              sx={{
                position: 'relative',
                borderTop: `1px solid ${panelBorder}`,
              }}
            >
              <FleetMap
                devices={mapDevices}
                focusRequest={focusRequest}
                height={{ xs: 340, sm: 420, lg: 435, xl: 490 }}
                selectedId={device.deviceId}
                onSelect={() => undefined}
              />
              {hasPosition && (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    position: 'absolute',
                    top: { xs: 9, sm: 12 },
                    left: { xs: 9, sm: 12 },
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

          <RouteHistory client={client} device={device} />
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: '1fr' },
            gap: 2,
            alignItems: 'start',
            minWidth: 0,
          }}
        >
          <DriverCard
            admin={admin}
            client={client}
            device={device}
            devices={devices}
            drivers={drivers}
            driversError={driversError}
            onChanged={onChanged}
            onDriversChanged={onDriversChanged}
          />
          <DetailsCard admin={admin} device={device} onEdit={() => setEditOpen(true)} />
          {connection}
          <PhoneSettingsCard admin={admin} client={client} device={device} onChanged={onChanged} />
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        <DriverActivityCard canMessage={canDispatch} client={client} device={device} />
        <VehicleAlertsCard
          alerts={alerts}
          canAcknowledge={canDispatch}
          client={client}
          coordinates={coordinates}
          device={device}
          driver={assignedDriver(device, drivers)}
          onChanged={onAlertsChanged}
        />
      </Box>

      <EditDetailsDialog
        client={client}
        device={device}
        open={editOpen}
        onClose={() => setEditOpen(false)}
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
        <Typography variant="h5">This vehicle is not in your fleet</Typography>
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
}: {
  device: Device;
  admin: boolean;
  onEdit: () => void;
}) {
  const odometerM = device.state?.odometerM;
  return (
    <Panel>
      <PanelHead
        title="Vehicle details"
        action={
          admin && (
            <Button onClick={onEdit} size="small" sx={textButtonSx}>
              Edit
            </Button>
          )
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
  client,
  onChanged,
  onDriversChanged,
}: {
  device: Device;
  devices: Device[];
  drivers?: Driver[];
  driversError: string;
  admin: boolean;
  client: TrackifyClient;
  onChanged: () => Promise<void>;
  onDriversChanged: () => Promise<void>;
}) {
  const driver = assignedDriver(device, drivers);
  const [assignOpen, setAssignOpen] = useState(false);
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
        title="Assigned driver"
        action={
          admin &&
          driver && (
            <Button onClick={() => setAssignOpen(true)} size="small" sx={textButtonSx}>
              Change
            </Button>
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
                  startIcon={<Phone size={16} />}
                  variant="contained"
                  sx={{ minHeight: 38, fontSize: 12 }}
                >
                  Call
                </Button>
              )}
              {admin && (
                <Button
                  color="inherit"
                  disabled={busy}
                  fullWidth
                  onClick={() => void assign(null)}
                  startIcon={<UserX size={16} />}
                  variant="outlined"
                  sx={{ minHeight: 38, fontSize: 12, borderColor: '#DCE2EB', color: '#39445A' }}
                >
                  Unassign
                </Button>
              )}
            </Stack>
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
                    : 'A fleet administrator can assign a driver.'}
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

const alertColors: Record<FleetAlert['severity'], [string, string]> = {
  critical: ['#D83A36', '#FFF0EF'],
  high: ['#B54708', '#FFF6DF'],
  warning: ['#A66A08', '#FFF6DF'],
};

/** Open alerts and recent ones for this vehicle, plus whether it has gone quiet. */
function VehicleAlertsCard({
  device,
  alerts,
  coordinates,
  canAcknowledge,
  client,
  driver,
  onChanged,
}: {
  device: Device;
  driver?: Driver;
  alerts?: FleetAlert[];
  coordinates?: string;
  canAcknowledge: boolean;
  client: TrackifyClient;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const own = (alerts ?? [])
    .filter((alert) => alert.deviceId === device.deviceId)
    .sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'))
    .slice(0, 5);
  const open = own.filter((alert) => alert.status === 'open').length;
  const quiet = notReporting(device);
  const attention = open + (quiet ? 1 : 0);

  async function acknowledge(alert: FleetAlert) {
    setBusy(alert.alertId);
    setError('');
    try {
      await client.acknowledgeAlert(alert.alertId);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Alert could not be updated');
    } finally {
      setBusy('');
    }
  }

  return (
    <Panel>
      <PanelHead
        section
        title="Alerts & status"
        caption="Items that may need your attention"
        action={
          !alerts ? undefined : attention ? (
            <Pill color="#D83A36" background="#FFF0EF">
              {attention} need{attention === 1 ? 's' : ''} attention
            </Pill>
          ) : (
            <Pill color="#16865B" background="#E8F8F0">
              All clear
            </Pill>
          )
        }
      />
      <Box sx={{ px: { xs: 1.75, sm: 2 }, pb: 1 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {quiet && (
          <StatusItem
            icon={<TriangleAlert size={16} />}
            colors={alertColors.critical}
            title="Phone not reachable"
            detail={`Last heard from ${
              device.state?.lastSeenAt ? timeAgo(device.state.lastSeenAt) : 'never'
            }. The driver is on shift, but the phone has stopped checking in: Android may have stopped the app, or the phone is off or has no internet. ${
              driver?.phone
                ? `Call ${driver.name} on ${driver.phone} and ask them to open the Trackify app.`
                : 'Ask the driver to open the Trackify app.'
            }`}
          />
        )}
        {!alerts ? (
          <CircularProgress size={22} sx={{ my: 1.5 }} />
        ) : (
          own.map((alert) => {
            const map = mapLink(alert.latitude, alert.longitude);
            return (
              <StatusItem
                key={alert.alertId}
                icon={<BellRing size={16} />}
                colors={
                  alert.status === 'open' ? alertColors[alert.severity] : ['#6F7A90', '#F0F2F6']
                }
                title={alertTitle(alert)}
                detail={[
                  `${new Date(alert.createdAt).toLocaleString('en-IN')} · ${timeAgo(alert.createdAt)}`,
                  alert.note && `“${alert.note}”`,
                  alert.status === 'acknowledged' &&
                    (alert.acknowledgedBy ? `handled by ${alert.acknowledgedBy}` : 'handled'),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                actions={
                  <>
                    {map && (
                      <Button
                        href={map}
                        rel="noreferrer"
                        size="small"
                        startIcon={<MapPin size={14} />}
                        sx={textButtonSx}
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
                        sx={textButtonSx}
                      >
                        Mark handled
                      </Button>
                    )}
                  </>
                }
              />
            );
          })
        )}
        {coordinates && (
          <StatusItem
            icon={<LocateFixed size={16} />}
            colors={['#285CF6', '#EDF3FF']}
            title="Last known location available"
            detail={`${coordinates} · GPS protocol ${device.protocol.toUpperCase()}`}
          />
        )}
        {alerts && !own.length && !quiet && !coordinates && (
          <Typography color="text.secondary" sx={{ fontSize: 12, py: 2, textAlign: 'center' }}>
            Nothing needs your attention.
          </Typography>
        )}
      </Box>
    </Panel>
  );
}

function StatusItem({
  icon,
  colors: [color, background],
  title,
  detail,
  actions,
}: {
  icon: ReactNode;
  colors: [string, string];
  title: string;
  detail: string;
  actions?: ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1.4} sx={{ py: 1.4, borderTop: `1px solid ${rowDivider}` }}>
      <Box
        sx={{
          width: 30,
          height: 30,
          flexShrink: 0,
          borderRadius: '10px',
          display: 'grid',
          placeItems: 'center',
          color,
          bgcolor: background,
        }}
      >
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700 }}>{title}</Typography>
        <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.4, wordBreak: 'break-word' }}>
          {detail}
        </Typography>
        {actions && (
          <Stack direction="row" spacing={0.5} sx={{ ml: -0.75, mt: 0.25 }}>
            {actions}
          </Stack>
        )}
      </Box>
    </Stack>
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
  onSaved,
}: {
  open: boolean;
  device: Device;
  client: TrackifyClient;
  onClose: () => void;
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
