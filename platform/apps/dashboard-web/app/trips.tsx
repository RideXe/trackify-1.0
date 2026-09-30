'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import type { Device, FleetTrip, TrackifyClient } from '@trackify/api-client';
import { Download } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { durationLabel, tripTotals, tripsCsv } from './fleet-views-data';
import { loadRoute, withoutDrift, type RoutePoint } from './route-data';
import { RouteMap } from './route-map';

const startOfDay = (offsetDays: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.getTime();
};
const periods = [
  { label: 'Today', from: () => startOfDay(0), to: () => Date.now() },
  { label: 'Yesterday', from: () => startOfDay(-1), to: () => startOfDay(0) - 1 },
  { label: 'Last 7 days', from: () => startOfDay(-6), to: () => Date.now() },
  { label: 'Last 30 days', from: () => startOfDay(-29), to: () => Date.now() },
];
const km = (m: number) => `${(m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} km`;
const clock = (ms: number) =>
  new Date(ms).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Completed trips across the fleet, as the vehicles recorded them; a trip still under way is not listed. */
export function TripsPage({
  devices,
  client,
  onOpenVehicle,
}: {
  devices: Device[];
  client: TrackifyClient;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [period, setPeriod] = useState(periods[0]!.label);
  const [deviceId, setDeviceId] = useState('');
  const [trips, setTrips] = useState<FleetTrip[]>();
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<FleetTrip>();
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    const chosen = periods.find((item) => item.label === period) ?? periods[0]!;
    setLoading(true);
    setError('');
    setSelected(undefined);
    try {
      const result = await client.fleetTrips(chosen.from(), chosen.to(), deviceId || undefined);
      if (request !== latest.current) return;
      setTrips(result.items);
      setTruncated(result.truncated);
    } catch (reason) {
      if (request === latest.current)
        setError(reason instanceof Error ? reason.message : 'Trips unavailable');
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [client, period, deviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  function download() {
    if (!trips?.length) return;
    const url = URL.createObjectURL(new Blob([tripsCsv(trips)], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `trackify-trips-${period.toLowerCase().replace(/\s+/g, '-')}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const totals = tripTotals(trips ?? []);
  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
      >
        <Box>
          <Typography variant="h4">Trips</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            Every completed journey, from when a vehicle started moving until it stopped.
          </Typography>
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
          <TextField
            select
            label="Vehicle"
            value={deviceId}
            onChange={(event) => setDeviceId(event.target.value)}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="">All vehicles</MenuItem>
            {devices.map((device) => (
              <MenuItem key={device.deviceId} value={device.deviceId}>
                {device.name}
              </MenuItem>
            ))}
          </TextField>
          <Button
            disabled={!trips?.length}
            onClick={download}
            startIcon={<Download size={16} />}
            variant="outlined"
          >
            CSV
          </Button>
        </Stack>
      </Stack>

      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        {periods.map((item) => (
          <Chip
            key={item.label}
            color={period === item.label ? 'primary' : 'default'}
            label={item.label}
            onClick={() => setPeriod(item.label)}
            variant={period === item.label ? 'filled' : 'outlined'}
          />
        ))}
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        {[
          ['Trips', trips ? String(totals.count) : '—'],
          ['Distance', trips ? km(totals.distanceM) : '—'],
          ['Driving time', trips ? durationLabel(totals.drivingMs) : '—'],
          ['Top speed', trips?.length ? `${Math.round(totals.maxSpeedKmh)} km/h` : '—'],
        ].map(([label, value]) => (
          <Paper key={label} sx={{ p: 2 }}>
            <Typography color="text.secondary" variant="caption">
              {label}
            </Typography>
            <Typography variant="h5">{value}</Typography>
          </Paper>
        ))}
      </Box>

      {loading && <LinearProgress />}
      {error && <Alert severity="error">Trips could not be loaded: {error}</Alert>}
      {truncated && (
        <Alert severity="info">
          A vehicle made more trips than fit in one list; pick a shorter period or one vehicle.
        </Alert>
      )}

      {trips && !trips.length && !loading ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h6">No completed trips in this period</Typography>
          <Typography color="text.secondary">
            A trip appears here once the vehicle has stopped at the end of it.
          </Typography>
        </Paper>
      ) : (
        trips &&
        trips.length > 0 && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: '420px minmax(0, 1fr)' },
              gap: 3,
              alignItems: 'start',
            }}
          >
            <Paper sx={{ maxHeight: { lg: 620 }, overflowY: 'auto' }}>
              <List disablePadding>
                {trips.map((trip) => (
                  <ListItemButton
                    key={`${trip.deviceId}-${trip.tripId}`}
                    selected={
                      selected?.tripId === trip.tripId && selected.deviceId === trip.deviceId
                    }
                    onClick={() => setSelected(trip)}
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                  >
                    <ListItemText
                      primary={`${trip.deviceName ?? 'Removed vehicle'} · ${km(trip.distanceM)}`}
                      secondary={`${clock(trip.startTime)} → ${clock(trip.endTime)} · ${durationLabel(trip.endTime - trip.startTime)} · top ${Math.round(trip.maxSpeedKmh)} km/h`}
                      slotProps={{ primary: { sx: { fontWeight: 650 } } }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Paper>
            {selected ? (
              <TripRoute
                key={`${selected.deviceId}-${selected.tripId}`}
                client={client}
                trip={selected}
                onOpenVehicle={onOpenVehicle}
              />
            ) : (
              <Paper sx={{ p: 4, textAlign: 'center' }}>
                <Typography color="text.secondary">Pick a trip to see its route.</Typography>
              </Paper>
            )}
          </Box>
        )
      )}
    </Stack>
  );
}

function TripRoute({
  trip,
  client,
  onOpenVehicle,
}: {
  trip: FleetTrip;
  client: TrackifyClient;
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [points, setPoints] = useState<RoutePoint[]>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    loadRoute(
      (from, to, limit) =>
        client.positions(trip.deviceId, from, to, limit).then((page) => page.items),
      trip.startTime,
      trip.endTime,
    )
      .then((route) => {
        if (active) setPoints(withoutDrift(route.points));
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Route unavailable');
      });
    return () => {
      active = false;
    };
  }, [client, trip]);

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2 }}
      >
        <Box>
          <Typography sx={{ fontWeight: 700 }}>{trip.deviceName ?? 'Removed vehicle'}</Typography>
          <Typography color="text.secondary" variant="body2">
            {clock(trip.startTime)} → {clock(trip.endTime)} · {km(trip.distanceM)}
          </Typography>
        </Box>
        {trip.deviceName && (
          <Button onClick={() => onOpenVehicle(trip.deviceId)} size="small">
            Open vehicle
          </Button>
        )}
      </Stack>
      {error ? (
        <Alert severity="warning">
          The route could not be loaded: {error}. GPS positions are kept for 90 days.
        </Alert>
      ) : !points ? (
        <Stack sx={{ alignItems: 'center', py: 8 }}>
          <CircularProgress size={26} />
        </Stack>
      ) : !points.length ? (
        <Alert severity="info">
          No stored GPS positions for this trip. Positions are kept for 90 days.
        </Alert>
      ) : (
        <RouteMap points={points} />
      )}
    </Paper>
  );
}
