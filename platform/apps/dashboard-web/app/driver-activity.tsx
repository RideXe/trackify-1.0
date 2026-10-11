'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import {
  defaultPauseLimitMinutes,
  defaultTrackerIntervalSeconds,
  pauseLimits,
  trackerIntervals,
  type ActivityEntry,
  type ActivityItem,
  type Device,
  type TrackifyClient,
} from '@trackify/api-client';
import {
  ArrowLeftRight,
  BellRing,
  CirclePause,
  CirclePlay,
  ClipboardCheck,
  Fuel,
  History,
  LogIn,
  LogOut,
  MapPin,
  Send,
  Siren,
  Smartphone,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  describeActivity,
  driverOf,
  inTab,
  intervalLabel,
  mapLink,
  type ActivityTab,
  type Tone,
} from './driver-activity-data';
import { Panel, PanelHead, panelBorder, rowDivider } from './panel';

/** Icon colour and its soft background, by how loudly an entry should read. */
const toneColors: Record<Tone, [string, string]> = {
  critical: ['#D92D20', '#FEF3F2'],
  warning: ['#DC6803', '#FFFAEB'],
  info: ['#155EEF', '#EFF4FF'],
  success: ['#079455', '#ECFDF3'],
};

const typeIcons: Record<ActivityEntry['type'], LucideIcon> = {
  'shift-start': LogIn,
  'shift-end': LogOut,
  pause: CirclePause,
  resume: CirclePlay,
  'driver-change': ArrowLeftRight,
  sos: Siren,
  issue: TriangleAlert,
  fuel: Fuel,
  check: ClipboardCheck,
  warning: Smartphone,
  message: Send,
};

/** Ready-made alerts; the wording is what the driver reads in the app. */
const templates = [
  'Please slow down',
  'Stop the vehicle now',
  'Customer is waiting',
  'Return to base',
  'Call the office',
  'Are you running late?',
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

/** The vehicle's last week of activity, refreshed every 30 s; shared by the log and Send alert. */
export function useActivity(client: TrackifyClient, deviceId: string) {
  const [items, setItems] = useState<ActivityItem[]>();
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      setItems((await client.activity(deviceId)).items);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Activity unavailable');
    }
  }, [client, deviceId]);
  useEffect(() => {
    void reload();
    const timer = window.setInterval(() => {
      if (!document.hidden) void reload();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [reload]);
  return { items, error, reload };
}

const tabs: Array<{ value: ActivityTab; label: string; empty: string }> = [
  {
    value: 'driver',
    label: 'Driver activity',
    empty: 'No shifts, pauses or driver changes in the last 7 days.',
  },
  {
    value: 'vehicle',
    label: 'Vehicle activity',
    empty: 'No reports, fuel, checks or warnings in the last 7 days.',
  },
];

/**
 * The vehicle's activity log in two tabs: what the driver did with their shift, and what happened
 * to the vehicle. Newest first, grouped by day, each entry naming the driver at the time.
 */
export function ActivityCard({
  items,
  error,
  canMessage,
  fill = false,
  onSendAlert,
}: {
  /** Undefined while loading. */
  items?: ActivityItem[];
  error: string;
  canMessage: boolean;
  /** Fill the parent's height (beside the map) and scroll inside, instead of a fixed maximum. */
  fill?: boolean;
  onSendAlert: () => void;
}) {
  const [tab, setTab] = useState<ActivityTab>('driver');
  const shown = useMemo(() => (items ?? []).filter((item) => inTab(item, tab)), [items, tab]);
  const count = (value: ActivityTab) => (items ?? []).filter((item) => inTab(item, value)).length;
  const pad = { px: { xs: 1.75, sm: 2 } };

  return (
    <Panel
      sx={{ display: 'flex', flexDirection: 'column', flex: 1, ...(fill && { height: '100%' }) }}
    >
      <PanelHead
        section
        icon={<History size={19} />}
        title="Activity"
        caption="Last 7 days"
        action={
          canMessage && (
            <Button
              onClick={onSendAlert}
              startIcon={<BellRing size={16} />}
              variant="contained"
              sx={{ minHeight: 36 }}
            >
              Send alert
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={(_, value: ActivityTab) => setTab(value)}
        variant="fullWidth"
        sx={{ borderBottom: `1px solid ${panelBorder}`, minHeight: 42 }}
      >
        {tabs.map(({ value, label }) => (
          <Tab
            key={value}
            value={value}
            label={items ? `${label} · ${count(value)}` : label}
            sx={{ minHeight: 42, fontSize: 13, fontWeight: 700, textTransform: 'none' }}
          />
        ))}
      </Tabs>
      {error && (
        <Box sx={{ ...pad, pt: 1.5 }}>
          <Alert severity="warning">Activity could not be loaded: {error}</Alert>
        </Box>
      )}
      <Box
        sx={{
          minHeight: 220,
          overflowY: 'auto',
          ...(fill
            ? { flex: 1, maxHeight: { xs: 480, md: 'none' } }
            : { maxHeight: { xs: 480, xl: 520 } }),
        }}
      >
        {!items && !error ? (
          <Box sx={{ ...pad, py: 3 }}>
            <CircularProgress size={22} />
          </Box>
        ) : !shown.length ? (
          <Typography
            color="text.secondary"
            sx={{ fontSize: 12, py: 5, px: 2, textAlign: 'center' }}
          >
            {tabs.find((item) => item.value === tab)!.empty}
          </Typography>
        ) : (
          shown.map((item, position) => {
            const previous = shown[position - 1];
            const newDay = !previous || dayLabel(previous.at) !== dayLabel(item.at);
            return (
              <Fragment key={item.entryId}>
                {newDay && (
                  <Typography
                    sx={{
                      ...pad,
                      py: 0.75,
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      bgcolor: '#F8FAFC',
                      borderBottom: `1px solid ${rowDivider}`,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: '0.4px',
                      textTransform: 'uppercase',
                      color: 'text.secondary',
                    }}
                  >
                    {dayLabel(item.at)}
                  </Typography>
                )}
                <ActivityRow item={item} />
              </Fragment>
            );
          })
        )}
      </Box>
    </Panel>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const { title, detail, tone } = describeActivity(item);
  const [color, background] = toneColors[tone];
  const Icon = typeIcons[item.type];
  const map = mapLink(item.latitude, item.longitude);
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        px: { xs: 1.75, sm: 2 },
        py: 1.4,
        alignItems: 'flex-start',
        '& + &': { borderTop: `1px solid ${rowDivider}` },
      }}
    >
      <Typography
        sx={{
          width: 58,
          flexShrink: 0,
          pt: 0.6,
          fontSize: 12,
          color: 'text.secondary',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {clock(item.at)}
      </Typography>
      <Box
        sx={{
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: '10px',
          display: 'grid',
          placeItems: 'center',
          color,
          bgcolor: background,
        }}
      >
        <Icon size={16} />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          sx={{
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.35,
            color: tone === 'critical' ? color : 'text.primary',
          }}
        >
          {title}
        </Typography>
        {detail && (
          <Typography
            color="text.secondary"
            sx={{ fontSize: 12, mt: 0.25, lineHeight: 1.45, wordBreak: 'break-word' }}
          >
            {detail}
          </Typography>
        )}
        <Stack
          direction="row"
          sx={{
            mt: 0.6,
            gap: 1.25,
            flexWrap: 'wrap',
            alignItems: 'center',
            fontSize: 11,
            color: 'text.secondary',
          }}
        >
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <UserRound size={12} />
            {driverOf(item)}
          </Box>
          {item.receivedAt - item.at > 120_000 && (
            <span title="Recorded offline on the phone and sent when it reconnected">
              Arrived late
            </span>
          )}
          {map && (
            <Link
              href={map}
              rel="noreferrer"
              target="_blank"
              underline="hover"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, fontSize: 11 }}
            >
              <MapPin size={12} />
              View on map
            </Link>
          )}
        </Stack>
        {item.photoUrl && (
          <Box
            component="a"
            href={item.photoUrl}
            rel="noreferrer"
            target="_blank"
            sx={{ display: 'inline-block', mt: 1 }}
          >
            <Box
              component="img"
              alt={title}
              src={item.photoUrl}
              sx={{
                width: 120,
                height: 90,
                objectFit: 'cover',
                borderRadius: '8px',
                border: `1px solid ${panelBorder}`,
              }}
            />
          </Box>
        )}
      </Box>
    </Stack>
  );
}

/**
 * Sends a short alert to the driver's Trackify app, and lists the alerts already sent this week.
 * A form and a log, not a chat: the driver cannot reply in the app.
 */
export function SendAlertDialog({
  open,
  device,
  client,
  driverName,
  messages,
  onClose,
  onSent,
}: {
  open: boolean;
  device: Device;
  client: TrackifyClient;
  driverName?: string;
  /** Alerts already sent, newest first. */
  messages: ActivityItem[];
  onClose: () => void;
  onSent: () => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');
  useEffect(() => {
    if (!open) return;
    setText('');
    setError('');
    setSent('');
  }, [open]);

  async function send() {
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    setError('');
    try {
      await client.sendMessage(device.deviceId, message);
      setSent(message);
      setText('');
      await onSent();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Alert not sent');
    } finally {
      setSending(false);
    }
  }

  const recipient = driverName ?? `the driver of ${device.name}`;
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle component="div" sx={{ pb: 1 }}>
        <Typography component="h2" sx={{ fontSize: 18, fontWeight: 800 }}>
          Send alert
        </Typography>
        <Typography color="text.secondary" variant="body2">
          To {recipient} · {device.name}. Shown in the Trackify app within about a minute.
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mb: 1 }}>
          Templates
        </Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
          {templates.map((template) => {
            const selected = text === template;
            return (
              <Button
                key={template}
                disabled={sending}
                onClick={() => setText(template)}
                size="small"
                variant={selected ? 'contained' : 'outlined'}
                sx={{
                  minHeight: 30,
                  px: 1.25,
                  borderRadius: '8px',
                  fontSize: 12,
                  fontWeight: 650,
                  ...(!selected && { borderColor: '#DCE2EB', color: '#39445A' }),
                }}
              >
                {template}
              </Button>
            );
          })}
        </Stack>
        <TextField
          disabled={sending}
          fullWidth
          label="Message"
          minRows={3}
          multiline
          onChange={(event) => setText(event.target.value)}
          placeholder="Write a short, clear instruction"
          value={text}
          helperText={`${text.length}/500`}
          slotProps={{ htmlInput: { maxLength: 500 } }}
        />
        {sent && (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            Alert sent to {recipient}.
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {error}
          </Alert>
        )}
        <Typography sx={{ fontSize: 13, fontWeight: 800, mt: 3, mb: 1 }}>
          Sent alerts · last 7 days
        </Typography>
        {messages.length ? (
          <Box sx={{ border: `1px solid ${panelBorder}`, borderRadius: '10px', overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow
                  sx={{
                    '& th': {
                      fontSize: 11,
                      fontWeight: 700,
                      color: 'text.secondary',
                      bgcolor: '#F8FAFC',
                    },
                  }}
                >
                  <TableCell>Sent</TableCell>
                  <TableCell>Message</TableCell>
                  <TableCell>By</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {messages.map((message) => (
                  <TableRow
                    key={message.entryId}
                    sx={{ '& td': { fontSize: 12, verticalAlign: 'top' } }}
                  >
                    <TableCell sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                      {dayLabel(message.at)}, {clock(message.at)}
                    </TableCell>
                    <TableCell sx={{ wordBreak: 'break-word' }}>{message.text}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', wordBreak: 'break-word' }}>
                      {message.sentBy ?? 'Office'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        ) : (
          <Typography color="text.secondary" sx={{ fontSize: 12 }}>
            No alerts sent in the last 7 days.
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button color="inherit" onClick={onClose}>
          Close
        </Button>
        <Button
          disabled={sending || !text.trim()}
          onClick={() => void send()}
          startIcon={<Send size={15} />}
          variant="contained"
        >
          {sending ? 'Sending…' : 'Send alert'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** How the driver's phone behaves, in a popup. Set here, never on the phone itself. */
export function PhoneSettingsDialog({
  open,
  device,
  admin,
  client,
  onChanged,
  onClose,
}: {
  open: boolean;
  device: Device;
  admin: boolean;
  client: TrackifyClient;
  onChanged: () => Promise<void>;
  onClose: () => void;
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle component="div" sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Box sx={{ color: 'primary.main', display: 'flex' }}>
            <Smartphone size={19} />
          </Box>
          <Typography component="h2" sx={{ fontSize: 18, fontWeight: 800 }}>
            Driver phone settings
          </Typography>
        </Stack>
        <Typography color="text.secondary" variant="body2" sx={{ mt: 0.5 }}>
          Applied on the phone within about a minute while the app is open.
          {!admin && ' Only administrators can change them.'}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
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
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{busy ? 'Saving…' : 'Done'}</Button>
      </DialogActions>
    </Dialog>
  );
}
