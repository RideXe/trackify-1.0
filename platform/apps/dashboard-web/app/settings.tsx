'use client';

import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  defaultTrackerIntervalSeconds,
  planFastestIntervalSeconds,
  subscriptionPlans,
  trackerIntervals,
  type Organisation,
  type SubscriptionPlan,
  type TrackifyClient,
} from '@trackify/api-client';
import { BadgeCheck, Building2, Clock3, MapPin } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { intervalLabel } from './driver-activity-data';
import { Panel, PanelHead } from './panel';

const planNames: Record<SubscriptionPlan, string> = {
  basic: 'Basic',
  standard: 'Standard',
  premium: 'Premium',
};

/** Time zones offered by name; an organisation set to another one keeps it as an extra choice. */
const timeZones: Array<[zone: string, label: string]> = [
  ['Asia/Kolkata', 'India (IST)'],
  ['Asia/Colombo', 'Sri Lanka'],
  ['Asia/Kathmandu', 'Nepal'],
  ['Asia/Dhaka', 'Bangladesh'],
  ['Asia/Dubai', 'UAE (Dubai)'],
  ['Asia/Singapore', 'Singapore'],
  ['Europe/London', 'United Kingdom'],
  ['America/New_York', 'US Eastern'],
  ['UTC', 'UTC'],
];
const defaultTimeZone = 'Asia/Kolkata';

/** The cheapest plan that allows an interval, for "Available on …" next to locked choices. */
function planFor(seconds: number): SubscriptionPlan {
  return subscriptionPlans.find((plan) => planFastestIntervalSeconds[plan] <= seconds) ?? 'premium';
}

interface Form {
  name: string;
  phone: string;
  interval: number;
  timeZone: string;
}

function formFrom(organisation: Organisation): Form {
  return {
    name: organisation.name,
    phone: organisation.dispatcherPhone ?? '',
    interval: organisation.trackerIntervalSeconds ?? defaultTrackerIntervalSeconds,
    timeZone: organisation.timeZone ?? defaultTimeZone,
  };
}

/**
 * Company-wide settings, in plain words: what drivers see in their app, how often phones send
 * their location, the time zone for reports, and the plan. Only administrators can change them.
 */
export function SettingsPage({ admin, client }: { admin: boolean; client: TrackifyClient }) {
  const [organisation, setOrganisation] = useState<Organisation>();
  const [form, setForm] = useState<Form>();
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string }>();

  useEffect(() => {
    client
      .organisation()
      .then((value) => {
        setOrganisation(value);
        setForm(formFrom(value));
      })
      .catch((reason: unknown) =>
        setLoadError(reason instanceof Error ? reason.message : 'Settings unavailable'),
      );
  }, [client]);

  const saved = organisation && formFrom(organisation);
  const dirty =
    form &&
    saved &&
    (form.name.trim() !== saved.name ||
      form.phone.trim() !== saved.phone ||
      form.interval !== saved.interval ||
      form.timeZone !== saved.timeZone);
  const set = (changes: Partial<Form>) => {
    setForm((current) => current && { ...current, ...changes });
    setResult(undefined);
  };

  async function save() {
    if (!form || !saved) return;
    const name = form.name.trim();
    const phone = form.phone.trim();
    if (!name) return setResult({ ok: false, message: 'Enter your company name.' });
    if (phone && (phone.length < 3 || phone.length > 20))
      return setResult({ ok: false, message: 'The office phone number looks too short or long.' });
    const changes: Parameters<TrackifyClient['updateOrganisation']>[0] = {};
    if (name !== saved.name) changes.name = name;
    if (phone !== saved.phone) changes.dispatcherPhone = phone || null;
    if (form.interval !== saved.interval) changes.trackerIntervalSeconds = form.interval;
    if (form.timeZone !== saved.timeZone) changes.timeZone = form.timeZone;
    setBusy(true);
    setResult(undefined);
    try {
      const next = await client.updateOrganisation(changes);
      setOrganisation(next);
      setForm(formFrom(next));
      setResult({
        ok: true,
        message: 'Saved. Drivers see the changes the next time their app checks in.',
      });
    } catch (reason) {
      setResult({
        ok: false,
        message: reason instanceof Error ? reason.message : 'Your changes were not saved.',
      });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <Alert severity="error">Settings could not be loaded: {loadError}</Alert>;
  if (!organisation || !form) return <CircularProgress size={28} />;

  const plan = organisation.plan ?? 'standard';
  const fastest = organisation.fastestTrackerIntervalSeconds ?? planFastestIntervalSeconds[plan];
  const locked = !admin || busy;
  const zones = timeZones.some(([zone]) => zone === form.timeZone)
    ? timeZones
    : [...timeZones, [form.timeZone, form.timeZone] as [string, string]];

  return (
    <Stack spacing={2} sx={{ maxWidth: 760, pb: dirty ? 10 : 0 }}>
      {!admin && <Alert severity="info">Only administrators can change these settings.</Alert>}
      {result && <Alert severity={result.ok ? 'success' : 'error'}>{result.message}</Alert>}

      <Section icon={<Building2 size={18} />} title="Your company">
        <TextField
          disabled={locked}
          fullWidth
          helperText={`Drivers see “Connected to ${form.name.trim() || '…'}” in their app.`}
          label="Company name"
          onChange={(event) => set({ name: event.target.value })}
          value={form.name}
          slotProps={{ htmlInput: { maxLength: 100 } }}
        />
        <TextField
          disabled={locked}
          fullWidth
          helperText="Drivers tap “Call office” in the app to ring this number. Leave it empty to hide that button."
          label="Office phone number"
          onChange={(event) => set({ phone: event.target.value })}
          placeholder="+91 98765 43210"
          type="tel"
          value={form.phone}
          slotProps={{ htmlInput: { maxLength: 20 } }}
        />
      </Section>

      <Section icon={<MapPin size={18} />} title="Location updates">
        <TextField
          disabled={locked}
          fullWidth
          helperText="Faster shows smoother movement on the map but uses more phone battery and mobile data. You can still choose a different speed for one vehicle on its page."
          label="Phones send their location every"
          onChange={(event) => set({ interval: Number(event.target.value) })}
          select
          value={form.interval}
        >
          {trackerIntervals.map((seconds) => {
            const allowed = seconds >= fastest;
            return (
              <MenuItem key={seconds} disabled={!allowed} value={seconds}>
                <Stack
                  direction="row"
                  sx={{ width: '100%', justifyContent: 'space-between', gap: 2 }}
                >
                  <span>{intervalLabel(seconds)}</span>
                  {!allowed && (
                    <Typography component="span" color="text.secondary" sx={{ fontSize: 12 }}>
                      Available on {planNames[planFor(seconds)]}
                    </Typography>
                  )}
                </Stack>
              </MenuItem>
            );
          })}
        </TextField>
      </Section>

      <Section icon={<Clock3 size={18} />} title="Time zone">
        <TextField
          disabled={locked}
          fullWidth
          helperText="Used for the times in daily reports and emails."
          label="Time zone"
          onChange={(event) => set({ timeZone: event.target.value })}
          select
          value={form.timeZone}
        >
          {zones.map(([zone, label]) => (
            <MenuItem key={zone} value={zone}>
              {label}
            </MenuItem>
          ))}
        </TextField>
      </Section>

      <Section icon={<BadgeCheck size={18} />} title="Your plan">
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ alignItems: 'center', p: 1.5, borderRadius: '12px', bgcolor: '#F5F8FF' }}
        >
          <Typography sx={{ fontWeight: 800, fontSize: 16 }}>{planNames[plan]}</Typography>
          <Typography color="text.secondary" sx={{ fontSize: 13 }}>
            Location every {intervalLabel(fastest)} at the fastest.
          </Typography>
        </Stack>
        <Typography color="text.secondary" sx={{ fontSize: 12 }}>
          To change your plan, contact Trackify support.
        </Typography>
      </Section>

      {admin && dirty && (
        <Paper
          elevation={0}
          sx={{
            position: 'sticky',
            bottom: 16,
            zIndex: 5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            p: 1.5,
            pl: 2,
            borderRadius: '14px',
            border: 1,
            borderColor: 'divider',
            boxShadow: '0 8px 24px rgba(23,32,51,.14)',
          }}
        >
          <Typography sx={{ flex: 1, fontSize: 13, fontWeight: 600 }}>
            You have unsaved changes
          </Typography>
          <Button
            color="inherit"
            disabled={busy}
            onClick={() => {
              setForm(formFrom(organisation));
              setResult(undefined);
            }}
          >
            Discard
          </Button>
          <Button disabled={busy} onClick={() => void save()} variant="contained">
            {busy ? 'Saving…' : 'Save changes'}
          </Button>
        </Paper>
      )}
    </Stack>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <Panel>
      <PanelHead icon={icon} section title={title} />
      <Stack spacing={2.5} sx={{ px: { xs: 1.75, sm: 2 }, pb: { xs: 2, sm: 2.5 } }}>
        {children}
      </Stack>
    </Panel>
  );
}
