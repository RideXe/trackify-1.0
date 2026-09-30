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
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import type { Device, Driver, TrackifyClient } from '@trackify/api-client';
import { CarFront, IdCard, Pencil, Phone, Trash2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  driverChanges,
  driverForm,
  driverFormError,
  driverInput,
  initials,
  telHref,
  vehiclesByDriver,
  type DriverForm,
} from './vehicle-data';

export function DriversPage({
  drivers,
  error,
  devices,
  admin,
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
  client: TrackifyClient;
  onChanged: () => Promise<void>;
  onRetry: () => void;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [editing, setEditing] = useState<Driver | 'new'>();
  const [removing, setRemoving] = useState('');
  const [removeError, setRemoveError] = useState('');
  const assignments = useMemo(() => vehiclesByDriver(devices), [devices]);

  async function remove(driver: Driver) {
    const vehicles = assignments.get(driver.driverId) ?? [];
    const unassigned = vehicles.length
      ? ` They will be unassigned from ${vehicles.map((vehicle) => vehicle.name).join(', ')}.`
      : '';
    if (!window.confirm(`Remove ${driver.name}?${unassigned} This cannot be undone.`)) return;
    setRemoving(driver.driverId);
    setRemoveError('');
    try {
      await client.deleteDriver(driver.driverId);
      await onChanged();
    } catch (reason) {
      setRemoveError(reason instanceof Error ? reason.message : 'Driver could not be removed');
    } finally {
      setRemoving('');
    }
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography variant="h4">Drivers</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            The people who drive your vehicles. Assign them from a vehicle&apos;s page.
          </Typography>
        </Box>
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
        <Paper sx={{ p: { xs: 3, sm: 6 } }}>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: '#EEF4FF', color: 'primary.main' }}>
              <IdCard size={30} />
            </Avatar>
            <Box>
              <Typography variant="h5">No drivers yet</Typography>
              <Typography color="text.secondary" sx={{ mt: 1, maxWidth: 460 }}>
                {admin
                  ? 'Add the people who drive your vehicles with their phone and licence number, then assign each one to a vehicle.'
                  : 'A fleet administrator has not added any drivers yet.'}
              </Typography>
            </Box>
            {admin && (
              <Button
                onClick={() => setEditing('new')}
                startIcon={<UserPlus size={18} />}
                variant="contained"
              >
                Add your first driver
              </Button>
            )}
          </Stack>
        </Paper>
      ) : (
        <Paper sx={{ overflow: 'hidden' }}>
          {drivers.map((driver) => {
            const vehicles = assignments.get(driver.driverId) ?? [];
            const contact = [
              driver.phone,
              driver.licenceNumber && `Licence ${driver.licenceNumber}`,
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <Stack
                key={driver.driverId}
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                sx={{
                  alignItems: { md: 'center' },
                  px: 2.5,
                  py: 2,
                  borderBottom: 1,
                  borderColor: 'divider',
                  '&:last-of-type': { borderBottom: 0 },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ alignItems: 'center', flex: 1, minWidth: 0 }}
                >
                  <DriverAvatar name={driver.name} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography noWrap sx={{ fontWeight: 650 }}>
                      {driver.name}
                    </Typography>
                    <Typography color="text.secondary" noWrap variant="body2">
                      {contact || 'No phone or licence entered'}
                    </Typography>
                  </Box>
                </Stack>
                <Stack direction="row" sx={{ flex: 1, flexWrap: 'wrap', gap: 0.75 }}>
                  {vehicles.length ? (
                    vehicles.map((vehicle) => (
                      <Chip
                        key={vehicle.deviceId}
                        icon={<CarFront size={14} />}
                        label={vehicle.name}
                        onClick={() => onOpenVehicle(vehicle.deviceId)}
                        size="small"
                        variant="outlined"
                      />
                    ))
                  ) : (
                    <Typography color="text.secondary" variant="body2">
                      Not assigned to a vehicle
                    </Typography>
                  )}
                </Stack>
                <Stack direction="row" spacing={0.5}>
                  {driver.phone && (
                    <Tooltip title={`Call ${driver.name}`}>
                      <IconButton aria-label={`Call ${driver.name}`} href={telHref(driver.phone)}>
                        <Phone size={18} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {admin && (
                    <>
                      <Tooltip title="Edit driver">
                        <IconButton
                          aria-label={`Edit ${driver.name}`}
                          onClick={() => setEditing(driver)}
                        >
                          <Pencil size={18} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Remove driver">
                        <IconButton
                          aria-label={`Remove ${driver.name}`}
                          color="error"
                          disabled={removing === driver.driverId}
                          onClick={() => void remove(driver)}
                        >
                          <Trash2 size={18} />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Stack>
              </Stack>
            );
          })}
        </Paper>
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
