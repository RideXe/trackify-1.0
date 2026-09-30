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
  Divider,
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
  type TrackifyClient,
} from '@trackify/api-client';
import { ArrowLeft, Pencil, Phone, Trash2, UserPlus, UserRound, UserX } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DriverActivityCard, PhoneSettingsCard } from './driver-activity';
import { dutyLabel, notReporting } from './driver-activity-data';
import { DriverAvatar, DriverFields } from './drivers';
import { FleetMap } from './fleet-map';
import { headingLabel, statusColors, statusLabels, timeAgo, vehicleStatus } from './fleet-map-data';
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

const km = (value: number) => `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;

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
  onBack,
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
  /** Dispatchers and administrators can message the driver. */
  canDispatch: boolean;
  client: TrackifyClient;
  /** The tracker pairing controls, which live with the rest of the setup-code flow. */
  connection: ReactNode;
  onBack: () => void;
  onChanged: () => Promise<void>;
  onDriversChanged: () => Promise<void>;
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

  const stats: Array<[string, string]> = [
    [
      'Speed now',
      status === 'moving'
        ? `${Math.round(state?.speedKmh ?? 0)} km/h`
        : status === 'parked'
          ? '0 km/h'
          : '—',
    ],
    [
      'Heading',
      status === 'moving' && state?.courseDeg !== undefined ? headingLabel(state.courseDeg) : '—',
    ],
    ['Distance today', activity ? km(activity.distanceKm) : '—'],
    ['Trips · 24 h', activity ? String(activity.trips) : '—'],
    ['Events · 24 h', activity ? String(activity.events) : '—'],
    ['Odometer', state?.odometerM !== undefined ? km(state.odometerM / 1000) : '—'],
  ];
  if (state?.trip)
    stats.splice(2, 0, [
      'This trip',
      `${km(state.trip.distanceM / 1000)} · top ${Math.round(state.trip.maxSpeedKmh)} km/h`,
    ]);
  const hasPosition = Number.isFinite(state?.latitude) && Number.isFinite(state?.longitude);

  return (
    <Stack spacing={3}>
      <Box>
        <Button onClick={onBack} startIcon={<ArrowLeft size={18} />} sx={{ ml: -1 }}>
          All vehicles
        </Button>
      </Box>

      <Paper sx={{ p: 2.5 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ alignItems: { md: 'center' } }}
        >
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}>
            <VehicleAvatar
              type={vehicleType}
              size={56}
              color="#FFFFFF"
              background={statusColors[status]}
            />
            <Box sx={{ minWidth: 0 }}>
              <Stack
                direction="row"
                spacing={1.25}
                sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}
              >
                <Typography component="h1" noWrap variant="h4">
                  {device.name}
                </Typography>
                <Chip
                  label={statusLabels[status]}
                  size="small"
                  sx={{
                    bgcolor: `${statusColors[status]}1A`,
                    color: statusColors[status],
                    fontWeight: 700,
                  }}
                />
                {notReporting(device) ? (
                  <Chip color="error" label="On shift · not reporting" size="small" />
                ) : (
                  dutyLabel(device) && (
                    <Chip label={dutyLabel(device)} size="small" variant="outlined" />
                  )
                )}
              </Stack>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {[vehicleIcons[vehicleType].label, device.model].filter(Boolean).join(' · ')} ·{' '}
                {state?.lastSeenAt
                  ? `last update ${timeAgo(state.lastSeenAt)}`
                  : 'no GPS update received yet'}
              </Typography>
            </Box>
          </Stack>
          {admin && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button
                onClick={() => setEditOpen(true)}
                startIcon={<Pencil size={17} />}
                variant="outlined"
              >
                Edit details
              </Button>
              <Tooltip title="Remove vehicle">
                <IconButton
                  aria-label={`Remove ${device.name}`}
                  color="error"
                  disabled={removeBusy}
                  onClick={() => void removeVehicle()}
                >
                  <Trash2 size={19} />
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
        <Divider sx={{ my: 2.5 }} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 2,
          }}
        >
          {stats.map(([label, value]) => (
            <Box key={label}>
              <Typography color="text.secondary" variant="caption">
                {label}
              </Typography>
              <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 380px' },
          gap: 3,
          alignItems: 'start',
        }}
      >
        <Paper sx={{ overflow: 'hidden' }}>
          <Box sx={{ p: 2 }}>
            <Typography sx={{ fontWeight: 700 }}>Live position</Typography>
            <Typography color="text.secondary" variant="caption">
              {hasPosition
                ? `${state!.latitude!.toFixed(5)}, ${state!.longitude!.toFixed(5)} · updates as it moves`
                : 'Waiting for the first GPS signal'}
            </Typography>
          </Box>
          <FleetMap devices={mapDevices} selectedId={device.deviceId} onSelect={() => undefined} />
        </Paper>
        <Stack spacing={3}>
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
        </Stack>
      </Box>

      <DriverActivityCard canMessage={canDispatch} client={client} device={device} />

      <RouteHistory client={client} device={device} />

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
    <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between', py: 0.75 }}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          fontWeight: value ? 650 : 400,
          color: value ? 'text.primary' : 'text.disabled',
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
    <Paper sx={{ p: 2.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ fontWeight: 700 }}>Vehicle details</Typography>
        {admin && (
          <Button onClick={onEdit} size="small">
            Edit
          </Button>
        )}
      </Stack>
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
    </Paper>
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
    <Paper sx={{ p: 2.5 }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontWeight: 700 }}>Driver</Typography>
        {admin && driver && (
          <Button onClick={() => setAssignOpen(true)} size="small">
            Change
          </Button>
        )}
      </Stack>
      {driver ? (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <DriverAvatar name={driver.name} size={48} />
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontWeight: 700 }}>
                {driver.name}
              </Typography>
              <Typography color="text.secondary" variant="body2">
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
                startIcon={<Phone size={17} />}
                variant="contained"
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
                startIcon={<UserX size={17} />}
                variant="outlined"
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
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Avatar sx={{ width: 48, height: 48, bgcolor: '#F2F4F7', color: '#98A2B3' }}>
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
    </Paper>
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
