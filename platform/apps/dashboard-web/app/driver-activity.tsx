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
import { Clock3, Gauge, Hand, House, PhoneCall, Send, UserRound } from 'lucide-react';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { describeActivity, intervalLabel, mapLink, type Tone } from './driver-activity-data';
import { timeAgo } from './fleet-map-data';
import { Panel, PanelHead, rowDivider } from './panel';

const toneColors: Record<Tone, string> = {
  critical: '#D92D20',
  warning: '#DC6803',
  info: '#155EEF',
  success: '#079455',
};

/** One tap sends these; the wording is what the driver reads in the app. */
const quickMessages: Array<{ text: string; Icon: ComponentType<{ size?: number }> }> = [
  { text: 'Please slow down', Icon: Gauge },
  { text: 'Stop the vehicle now', Icon: Hand },
  { text: 'Customer is waiting', Icon: UserRound },
  { text: 'Return to base', Icon: House },
  { text: 'Call the office', Icon: PhoneCall },
  { text: 'Are you running late?', Icon: Clock3 },
];

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });

function dayLabel(ms: number, now = Date.now()) {
  const day = new Date(ms).setHours(0, 0, 0, 0);
  const today = new Date(now).setHours(0, 0, 0, 0);
  if (day === today) return 'Today';
  if (day === today - 86_400_000) return 'Yesterday';
  return new Date(ms).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Everything the driver did in the app over the last week, as a conversation: driver events
 * on the left, messages from the office on the right, newest at the bottom next to the reply box.
 */
export function DriverActivityCard({
  device,
  client,
  canMessage,
  driverName,
}: {
  device: Device;
  client: TrackifyClient;
  canMessage: boolean;
  /** The driver assigned now; older entries carry the name of whoever drove then. */
  driverName?: string;
}) {
  const [items, setItems] = useState<ActivityItem[]>();
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [sent, setSent] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

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

  // Newest is at the bottom, so keep the view there as entries arrive.
  const newest = items?.[0]?.entryId;
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [newest]);

  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(''), 3000);
    return () => window.clearTimeout(timer);
  }, [sent]);

  async function send(value: string, fromBox: boolean) {
    const message = value.trim();
    if (!message || sending) return;
    setSending(true);
    setSendError('');
    try {
      await client.sendMessage(device.deviceId, message);
      if (fromBox) setText('');
      setSent(message);
      await load();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : 'Message not sent');
    } finally {
      setSending(false);
    }
  }

  const timeline = useMemo(() => [...(items ?? [])].reverse(), [items]);
  const pad = { px: { xs: 1.75, sm: 2 } };

  return (
    <Panel sx={{ display: 'flex', flexDirection: 'column' }}>
      <PanelHead
        section
        title="Driver activity"
        caption={
          driverName
            ? `${driverName} · shifts, pauses, SOS, reports and messages · last 7 days`
            : 'Shifts, pauses, SOS, reports and messages · last 7 days'
        }
      />
      {error && (
        <Box sx={{ ...pad, pb: 1.5 }}>
          <Alert severity="warning">Driver activity could not be loaded: {error}</Alert>
        </Box>
      )}
      <Box
        ref={scroller}
        sx={{
          ...pad,
          py: 1.5,
          flex: 1,
          minHeight: 220,
          maxHeight: { xs: 460, xl: 470 },
          overflowY: 'auto',
          bgcolor: '#FAFBFD',
          borderTop: `1px solid ${rowDivider}`,
          borderBottom: `1px solid ${rowDivider}`,
        }}
      >
        {!items && !error ? (
          <CircularProgress size={22} />
        ) : items && !items.length ? (
          <Typography color="text.secondary" sx={{ fontSize: 12, py: 4, textAlign: 'center' }}>
            Nothing yet. Activity appears once the driver uses the Trackify app on shift.
          </Typography>
        ) : (
          timeline.map((item, position) => {
            const previous = timeline[position - 1];
            const newDay = !previous || dayLabel(previous.at) !== dayLabel(item.at);
            return (
              <Fragment key={item.entryId}>
                {newDay && (
                  <Typography
                    sx={{
                      textAlign: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'text.secondary',
                      my: 1.25,
                    }}
                  >
                    {dayLabel(item.at)}
                  </Typography>
                )}
                {item.type === 'message' ? (
                  <OfficeMessage item={item} />
                ) : (
                  <DriverEvent item={item} />
                )}
              </Fragment>
            );
          })
        )}
      </Box>
      {canMessage && (
        <Box sx={{ ...pad, py: 1.75 }}>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 1.25 }}>
            {quickMessages.map(({ text: quick, Icon }) => (
              <Button
                key={quick}
                disabled={sending}
                onClick={() => void send(quick, false)}
                size="small"
                startIcon={<Icon size={14} />}
                variant="outlined"
                sx={{
                  minHeight: 30,
                  px: 1.25,
                  borderRadius: '20px',
                  fontSize: 12,
                  fontWeight: 650,
                  borderColor: '#DCE2EB',
                  color: '#39445A',
                  '&:hover': {
                    borderColor: 'primary.main',
                    color: 'primary.main',
                    bgcolor: '#EDF3FF',
                  },
                }}
              >
                {quick}
              </Button>
            ))}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              id="driver-message"
              placeholder={driverName ? `Message ${driverName}…` : 'Message the driver…'}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send(text, true);
                }
              }}
              slotProps={{ htmlInput: { maxLength: 500, 'aria-label': 'Message the driver' } }}
            />
            <Button
              disabled={sending || !text.trim()}
              onClick={() => void send(text, true)}
              startIcon={<Send size={15} />}
              variant="contained"
              sx={{ minHeight: 40 }}
            >
              Send
            </Button>
          </Stack>
          <Typography
            color={sent ? 'success.main' : 'text.secondary'}
            sx={{ fontSize: 11, mt: 0.75, fontWeight: sent ? 650 : 400 }}
          >
            {sent
              ? `Sent: “${sent}”`
              : 'The driver sees it within about a minute while the Trackify app is open.'}
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

function DriverEvent({ item }: { item: ActivityItem }) {
  const { title, detail, tone } = describeActivity(item);
  const map = mapLink(item.latitude, item.longitude);
  return (
    <Stack direction="row" sx={{ mb: 1.5, maxWidth: '85%' }}>
      <Box
        sx={{
          minWidth: 0,
          px: 1.75,
          py: 1.25,
          bgcolor: '#FFFFFF',
          border: `1px solid ${tone === 'critical' ? '#F3D1CF' : rowDivider}`,
          borderLeft: `4px solid ${toneColors[tone]}`,
          borderRadius: '16px 16px 16px 4px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', mb: 0.25 }}>
          {item.driverName ?? 'Driver'}
        </Typography>
        <Typography
          sx={{
            fontSize: 14,
            fontWeight: 600,
            color: tone === 'critical' ? toneColors.critical : 'text.primary',
            lineHeight: 1.3,
          }}
        >
          {title}
        </Typography>
        {detail && (
          <Typography sx={{ fontSize: 13, wordBreak: 'break-word', mt: 0.5, lineHeight: 1.4, color: 'text.secondary' }}>
            {detail}
          </Typography>
        )}
        {item.photoUrl && (
          <Box
            component="a"
            href={item.photoUrl}
            rel="noreferrer"
            target="_blank"
            sx={{ display: 'block', mt: 1.5 }}
          >
            <Box
              component="img"
              alt={title}
              src={item.photoUrl}
              sx={{ width: 180, height: 135, objectFit: 'cover', borderRadius: 2 }}
            />
          </Box>
        )}
        <Typography color="text.secondary" sx={{ fontSize: 10, mt: 0.75, textAlign: 'right' }}>
          {clock(item.at)}
          {item.receivedAt - item.at > 120_000 ? ' · late' : ''}
          {map && (
            <>
              {' · '}
              <Link href={map} rel="noreferrer" target="_blank" color="inherit" underline="hover">
                map
              </Link>
            </>
          )}
        </Typography>
      </Box>
    </Stack>
  );
}

function OfficeMessage({ item }: { item: ActivityItem }) {
  return (
    <Stack sx={{ alignItems: 'flex-end', mb: 1.5 }}>
      <Box
        sx={{
          maxWidth: '85%',
          px: 1.75,
          py: 1.25,
          bgcolor: '#155EEF',
          color: '#FFFFFF',
          borderRadius: '16px 16px 4px 16px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        <Typography sx={{ fontSize: 14, wordBreak: 'break-word', lineHeight: 1.4 }}>
          {item.text}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 0.5, justifyContent: 'flex-end', alignItems: 'center', opacity: 0.9 }}>
          <Typography sx={{ fontSize: 10 }}>
            {item.sentBy ?? 'Office'}
            {item.driverName ? ` → ${item.driverName}` : ''}
          </Typography>
          <Typography sx={{ fontSize: 10 }}>{clock(item.at)}</Typography>
        </Stack>
      </Box>
    </Stack>
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
