'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { FleetAlert, TrackifyClient } from '@trackify/api-client';
import { BellRing, CheckCircle2, MapPin, Siren } from 'lucide-react';
import { useState } from 'react';
import { alertTitle, mapLink } from './driver-activity-data';
import { timeAgo } from './fleet-map-data';

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

export function AlertsPage({
  alerts,
  error,
  canAcknowledge,
  client,
  onChanged,
  onOpenVehicle,
}: {
  /** Undefined while loading. */
  alerts?: FleetAlert[];
  error: string;
  canAcknowledge: boolean;
  client: TrackifyClient;
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
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
      >
        <Box>
          <Typography variant="h4">Alerts</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            SOS, issues drivers reported, and phone problems that stop tracking.
          </Typography>
        </Box>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          onChange={(_, value: 'open' | 'all' | null) => value && setFilter(value)}
        >
          <ToggleButton value="open">Open</ToggleButton>
          <ToggleButton value="all">All recent</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {error && <Alert severity="error">Alerts could not be loaded: {error}</Alert>}
      {actionError && (
        <Alert severity="error" onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}
      {!alerts && !error ? (
        <Stack sx={{ alignItems: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Stack>
      ) : !shown.length ? (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <CheckCircle2 color="#079455" size={36} />
          <Typography variant="h6" sx={{ mt: 1 }}>
            {filter === 'open' ? 'No open alerts' : 'No recent alerts'}
          </Typography>
        </Paper>
      ) : (
        <Paper sx={{ overflow: 'hidden' }}>
          {shown.map((alert) => {
            const map = mapLink(alert.latitude, alert.longitude);
            return (
              <Stack
                key={alert.alertId}
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                sx={{
                  px: 2.5,
                  py: 2,
                  alignItems: { md: 'center' },
                  borderBottom: 1,
                  borderColor: 'divider',
                  borderLeft: 4,
                  borderLeftColor: severityColors[alert.severity],
                  '&:last-of-type': { borderBottom: 0 },
                  opacity: alert.status === 'open' ? 1 : 0.65,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                  >
                    <BellRing color={severityColors[alert.severity]} size={17} />
                    <Typography sx={{ fontWeight: 700 }}>{alertTitle(alert)}</Typography>
                    <Chip
                      label={alert.deviceName}
                      onClick={() => onOpenVehicle(alert.deviceId)}
                      size="small"
                      variant="outlined"
                    />
                  </Stack>
                  <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
                    {new Date(alert.createdAt).toLocaleString('en-IN')} · {timeAgo(alert.createdAt)}
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
          })}
        </Paper>
      )}
    </Stack>
  );
}
