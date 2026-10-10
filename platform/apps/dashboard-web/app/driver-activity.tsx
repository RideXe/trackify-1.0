'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Link,
  MenuItem,
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
import { CircleCheck, Info, Send, Siren, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { describeActivity, intervalLabel, mapLink, type Tone } from './driver-activity-data';
import { timeAgo } from './fleet-map-data';
import { Panel, PanelHead, rowDivider, textButtonSx } from './panel';

const toneColors: Record<Tone, string> = {
  critical: '#D92D20',
  warning: '#DC6803',
  info: '#155EEF',
  success: '#079455',
};

const toneIcons: Record<Tone, ComponentType<{ size?: number }>> = {
  critical: Siren,
  warning: TriangleAlert,
  info: Info,
  success: CircleCheck,
};

/** Items shown before "View all". */
const SHORT_LIST = 4;

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
  const [expanded, setExpanded] = useState(false);

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

  const shown = expanded ? items : items?.slice(0, SHORT_LIST);
  const pad = { px: { xs: 1.75, sm: 2 } };

  return (
    <Panel>
      <PanelHead
        section
        title="Driver activity"
        caption="Shifts, pauses, SOS, reports and messages · last 7 days"
        action={
          items && items.length > SHORT_LIST ? (
            <Button onClick={() => setExpanded((value) => !value)} size="small" sx={textButtonSx}>
              {expanded ? 'Show less' : `View all (${items.length})`}
            </Button>
          ) : undefined
        }
      />
      <Box sx={{ ...pad, pb: 1 }}>
        {error && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            Driver activity could not be loaded: {error}
          </Alert>
        )}
        {!items && !error ? (
          <CircularProgress size={22} sx={{ mb: 1.5 }} />
        ) : items && !items.length ? (
          <Typography color="text.secondary" sx={{ fontSize: 12, pb: 1.5 }}>
            Nothing yet. Activity appears once the driver uses the Trackify app on shift.
          </Typography>
        ) : (
          shown?.map((item) => {
            const { title, detail, tone } = describeActivity(item);
            const map = mapLink(item.latitude, item.longitude);
            const Icon = toneIcons[tone];
            return (
              <Stack
                key={item.entryId}
                direction="row"
                spacing={1.4}
                sx={{ py: 1.4, borderTop: `1px solid ${rowDivider}` }}
              >
                <Box
                  sx={{
                    width: 30,
                    height: 30,
                    flexShrink: 0,
                    borderRadius: '10px',
                    display: 'grid',
                    placeItems: 'center',
                    color: toneColors[tone],
                    bgcolor: `${toneColors[tone]}14`,
                  }}
                >
                  <Icon size={15} />
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography
                    sx={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: tone === 'critical' ? toneColors.critical : undefined,
                    }}
                  >
                    {title}
                  </Typography>
                  {detail && (
                    <Typography sx={{ fontSize: 12, wordBreak: 'break-word', mt: 0.25 }}>
                      {detail}
                    </Typography>
                  )}
                  <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.4 }}>
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
          })
        )}
      </Box>
      {canMessage && (
        <Box sx={{ ...pad, pb: 2 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              placeholder="Message the driver…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              slotProps={{ htmlInput: { maxLength: 500, 'aria-label': 'Message the driver' } }}
            />
            <Button
              disabled={sending || !text.trim()}
              onClick={() => void send()}
              startIcon={<Send size={15} />}
              variant="contained"
              sx={{ minHeight: 40 }}
            >
              Send
            </Button>
          </Stack>
          <Typography color="text.secondary" sx={{ fontSize: 11, mt: 0.75 }}>
            The driver sees it within about a minute while the Trackify app is open.
          </Typography>
          {sendError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {sendError}
            </Alert>
          )}
        </Box>
      )}
    </Panel>
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
    <Panel>
      <PanelHead
        title="Driver phone settings"
        caption="Applied on the phone within about a minute while the app is open."
      />
      <Box sx={{ px: { xs: 1.75, sm: 2 }, pb: { xs: 1.75, sm: 2 } }}>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
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
      </Box>
    </Panel>
  );
}
