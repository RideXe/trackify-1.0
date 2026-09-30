'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  defaultPauseLimitMinutes,
  defaultTrackerIntervalSeconds,
  pauseLimits,
  trackerIntervals,
  type ActivityItem,
  type Device,
  type TrackifyClient,
} from '@trackify/api-client';
import { Send } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { describeActivity, intervalLabel, mapLink, type Tone } from './driver-activity-data';
import { timeAgo } from './fleet-map-data';

const toneColors: Record<Tone, string> = {
  critical: '#D92D20',
  warning: '#DC6803',
  info: '#155EEF',
  success: '#079455',
};

/** Everything the driver did in the app over the last week, plus messages to them. */
export function DriverActivityCard({
  device,
  client,
  canMessage,
}: {
  device: Device;
  client: TrackifyClient;
  canMessage: boolean;
}) {
  const [items, setItems] = useState<ActivityItem[]>();
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  const load = useCallback(async () => {
    try {
      setItems((await client.activity(device.deviceId)).items);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Activity unavailable');
    }
  }, [client, device.deviceId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function send() {
    const message = text.trim();
    if (!message) return;
    setSending(true);
    setSendError('');
    try {
      await client.sendMessage(device.deviceId, message);
      setText('');
      await load();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'Message not sent');
    } finally {
      setSending(false);
    }
  }

  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography sx={{ fontWeight: 700 }}>Driver activity</Typography>
      <Typography color="text.secondary" variant="caption">
        Shifts, pauses, SOS, reports and messages from the last 7 days
      </Typography>
      {canMessage && (
        <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'flex-start' }}>
          <TextField
            fullWidth
            placeholder="Message the driver, e.g. go to the Whitefield depot next"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            slotProps={{ htmlInput: { maxLength: 500 } }}
          />
          <Button
            disabled={sending || !text.trim()}
            onClick={() => void send()}
            startIcon={<Send size={16} />}
            variant="contained"
          >
            Send
          </Button>
        </Stack>
      )}
      {canMessage && (
        <Typography color="text.secondary" variant="caption">
          The driver sees it within about a minute while the Trackify app is open.
        </Typography>
      )}
      {sendError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {sendError}
        </Alert>
      )}
      {error && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          Driver activity could not be loaded: {error}
        </Alert>
      )}
      {!items && !error ? (
        <CircularProgress size={22} sx={{ mt: 2 }} />
      ) : items && !items.length ? (
        <Typography color="text.secondary" variant="body2" sx={{ mt: 2 }}>
          Nothing yet. Activity appears once the driver uses the Trackify app on shift.
        </Typography>
      ) : (
        <Stack sx={{ mt: 2 }}>
          {items?.map((item) => {
            const { title, detail, tone } = describeActivity(item);
            const map = mapLink(item.latitude, item.longitude);
            return (
              <Stack
                key={item.entryId}
                direction="row"
                spacing={1.5}
                sx={{ py: 1.25, borderTop: 1, borderColor: 'divider' }}
              >
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    mt: 0.75,
                    borderRadius: '50%',
                    flexShrink: 0,
                    bgcolor: toneColors[tone],
                  }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    sx={{
                      fontWeight: 650,
                      color: tone === 'critical' ? toneColors.critical : undefined,
                    }}
                  >
                    {title}
                  </Typography>
                  {detail && (
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                      {detail}
                    </Typography>
                  )}
                  <Typography color="text.secondary" variant="caption">
                    {new Date(item.at).toLocaleString('en-IN')} · {timeAgo(item.at)}
                    {item.receivedAt - item.at > 120_000 ? ' · sent late (no signal)' : ''}
                    {map && (
                      <>
                        {' · '}
                        <Link href={map} rel="noreferrer" target="_blank">
                          map
                        </Link>
                      </>
                    )}
                  </Typography>
                  {item.photoUrl && (
                    <Box
                      component="a"
                      href={item.photoUrl}
                      rel="noreferrer"
                      target="_blank"
                      sx={{ display: 'block', mt: 1 }}
                    >
                      <Box
                        component="img"
                        alt={title}
                        src={item.photoUrl}
                        sx={{ width: 160, height: 120, objectFit: 'cover', borderRadius: 1.5 }}
                      />
                    </Box>
                  )}
                </Box>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}

/** How the driver's phone behaves. Set here, never on the phone itself. */
export function PhoneSettingsCard({
  device,
  admin,
  client,
  onChanged,
}: {
  device: Device;
  admin: boolean;
  client: TrackifyClient;
  onChanged: () => Promise<void>;
}) {
  const interval = device.trackerIntervalSeconds ?? defaultTrackerIntervalSeconds;
  const pauseLimit = device.pauseLimitMinutes ?? defaultPauseLimitMinutes;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(changes: { trackerIntervalSeconds?: number; pauseLimitMinutes?: number }) {
    setBusy(true);
    setError('');
    try {
      await client.updateDevice(device.deviceId, changes);
      await onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Setting not saved');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography sx={{ fontWeight: 700 }}>Driver phone settings</Typography>
      <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
        Applied on the phone within about a minute while the app is open.
      </Typography>
      <Stack spacing={2}>
        <TextField
          disabled={!admin || busy}
          label="Location update every"
          onChange={(event) => void save({ trackerIntervalSeconds: Number(event.target.value) })}
          select
          value={interval}
          helperText="Shorter is smoother on the map but uses more phone battery and data."
        >
          {trackerIntervals.map((seconds) => (
            <MenuItem key={seconds} value={seconds}>
              {intervalLabel(seconds)}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          disabled={!admin || busy}
          label="Longest pause"
          onChange={(event) => void save({ pauseLimitMinutes: Number(event.target.value) })}
          select
          value={pauseLimit}
          helperText="“I'm outside the vehicle” stops sharing for at most this long, then it resumes by itself."
        >
          {pauseLimits.map((minutes) => (
            <MenuItem key={minutes} value={minutes}>
              {minutes} min
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </Paper>
  );
}
