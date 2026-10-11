'use client';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  Slider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { Device, TrackifyClient } from '@trackify/api-client';
import { Download, History, Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAX_ROUTE_POINTS,
  loadRoute,
  routeFileName,
  routeToCsv,
  routeToGpx,
  routeToKml,
  summarizeRoute,
  withoutDrift,
  type LoadedRoute,
} from './route-data';
import { Panel, PanelHead, panelBorder } from './panel';
import { RouteMap } from './route-map';

interface Period {
  from: number;
  to: number;
}

const today = { label: 'Today', period: () => ({ from: startOfDay(0), to: Date.now() }) };
const presets: Array<{ label: string; period: () => Period }> = [
  today,
  { label: 'Yesterday', period: () => ({ from: startOfDay(-1), to: startOfDay(0) - 1 }) },
  { label: 'Last 24 h', period: () => ({ from: Date.now() - 86_400_000, to: Date.now() }) },
  { label: '7 days', period: () => ({ from: startOfDay(-6), to: Date.now() }) },
];

/** Replay moves this many GPS points per 200 ms tick. */
const replaySpeeds = [1, 5, 20] as const;

const downloads = {
  kml: { label: 'KML · Google Earth', type: 'application/vnd.google-earth.kml+xml' },
  gpx: { label: 'GPX · GPS apps', type: 'application/gpx+xml' },
  csv: { label: 'CSV · Excel', type: 'text/csv' },
} as const;

export function RouteHistory({ device, client }: { device: Device; client: TrackifyClient }) {
  const [preset, setPreset] = useState(today.label);
  const [period, setPeriod] = useState<Period>(today.period);
  const [route, setRoute] = useState<LoadedRoute & Period>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(replaySpeeds[0]);
  const latestRequest = useRef(0);

  async function show(next: Period) {
    const request = ++latestRequest.current;
    const to = Math.min(next.to, Date.now());
    setLoading(true);
    setError('');
    setPlaying(false);
    try {
      const loaded = await loadRoute(
        (from, upper, limit) =>
          client.positions(device.deviceId, from, upper, limit).then((page) => page.items),
        next.from,
        to,
      );
      if (request !== latestRequest.current) return;
      setRoute({ ...loaded, from: next.from, to });
      setIndex(0);
    } catch (reason) {
      if (request === latestRequest.current)
        setError(reason instanceof Error ? reason.message : 'Route history unavailable');
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  function choose(label: string, next: Period) {
    setPreset(label);
    setPeriod(next);
    void show(next);
  }

  useEffect(() => {
    setRoute(undefined);
    choose(today.label, today.period());
  }, [device.deviceId]);

  const points = useMemo(() => route?.points ?? [], [route]);
  const summary = useMemo(() => summarizeRoute(points), [points]);
  // What is drawn, replayed and downloaded: the route without GPS drift while parked.
  const driven = useMemo(() => withoutDrift(points), [points]);
  const current = driven[index];
  const lastIndex = Math.max(driven.length - 1, 0);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => setIndex((value) => Math.min(value + speed, lastIndex)),
      200,
    );
    return () => window.clearInterval(timer);
  }, [playing, speed, lastIndex]);

  useEffect(() => {
    if (playing && index >= lastIndex) setPlaying(false);
  }, [playing, index, lastIndex]);

  function download(kind: keyof typeof downloads) {
    if (!route?.points.length) return;
    const title = `${device.name} route`;
    const content =
      kind === 'kml'
        ? routeToKml(title, driven)
        : kind === 'gpx'
          ? routeToGpx(title, driven)
          : routeToCsv(driven);
    const url = URL.createObjectURL(new Blob([content], { type: downloads[kind].type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = routeFileName(device.name, route.from, route.to, kind);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const now = Date.now();
  const invalidPeriod = period.from >= period.to || period.from > now;

  const hasPoints = Boolean(route?.points.length);
  const pad = { px: { xs: 1.75, sm: 2 } };
  const notices = route
    ? [
        points.length > driven.length &&
          `${(points.length - driven.length).toLocaleString()} readings within GPS drift of a parked position are not drawn or counted as distance.`,
        route.skipped > 0 &&
          `${route.skipped.toLocaleString()} positions reported without a GPS lock are not shown.`,
      ].filter((notice): notice is string => Boolean(notice))
    : [];

  return (
    <Panel>
      <PanelHead
        section
        title="Route history"
        caption={`Where ${device.name} went in a chosen period. Positions are kept for 90 days.`}
        action={
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: { xs: '1px', sm: 0.6 } }}>
            {presets.map(({ label, period: next }) => (
              <Button
                key={label}
                aria-pressed={preset === label}
                onClick={() => choose(label, next())}
                size="small"
                sx={{
                  minHeight: 0,
                  px: { xs: 0.9, sm: 1.1 },
                  py: 0.85,
                  borderRadius: '8px',
                  fontSize: 11,
                  fontWeight: 700,
                  color: preset === label ? 'primary.main' : '#6B768A',
                  bgcolor: preset === label ? '#EDF3FF' : 'transparent',
                }}
              >
                {label}
              </Button>
            ))}
          </Stack>
        }
      />

      <Box
        sx={{
          ...pad,
          pb: 2,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr auto' },
          gap: { xs: 1, sm: 1.25 },
          alignItems: 'start',
        }}
      >
        {(['from', 'to'] as const).map((edge) => (
          <TextField
            key={edge}
            fullWidth
            label={edge === 'from' ? 'From' : 'To'}
            type="datetime-local"
            size="small"
            value={toLocalInput(period[edge])}
            onChange={(event) => {
              const value = fromLocalInput(event.target.value);
              if (value === undefined) return;
              setPreset('Custom');
              setPeriod((existing) => ({ ...existing, [edge]: value }));
            }}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { max: toLocalInput(now) },
            }}
          />
        ))}
        <Button
          disabled={loading || invalidPeriod}
          onClick={() => void show(period)}
          startIcon={
            loading ? <CircularProgress color="inherit" size={16} /> : <History size={16} />
          }
          variant="contained"
          sx={{ minHeight: 38, mt: { sm: 0.25 }, height: 38, width: { xs: '100%', sm: 'auto' } }}
        >
          {loading ? 'Loading…' : 'Show route'}
        </Button>
      </Box>

      {loading && <LinearProgress sx={{ mt: -2 }} />}

      {route && hasPoints && (
        <Stack
          direction="row"
          sx={{
            px: { xs: 1.75, sm: 2 },
            py: 1.25,
            borderTop: `1px solid ${panelBorder}`,
            borderBottom: `1px solid ${panelBorder}`,
            gap: { xs: 2, sm: 4 },
            flexWrap: 'wrap',
            bgcolor: '#FAFBFD',
          }}
        >
          {[
            ['Distance', `${(summary.distanceM / 1000).toFixed(1)} km`],
            ['Duration', formatDuration(summary.durationMs)],
            ['Top speed', `${Math.round(summary.maxSpeedKmh)} km/h`],
            ['GPS points', route.points.length.toLocaleString()],
          ].map(([label, value]) => (
            <Box key={label}>
              <Typography color="text.secondary" sx={{ fontSize: 10, mb: 0.25 }}>
                {label}
              </Typography>
              <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{value}</Typography>
            </Box>
          ))}
        </Stack>
      )}

      {error && (
        <Box sx={{ ...pad, pb: 2, pt: 2 }}>
          <Alert severity="error">{error}</Alert>
        </Box>
      )}

      {route && !loading && !route.points.length && (
        <Box sx={{ ...pad, pb: 2, pt: 2 }}>
          <Stack
            spacing={0.75}
            sx={{
              minHeight: 160,
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: '#F8FAFF',
              borderRadius: '12px',
              textAlign: 'center',
              px: 2,
            }}
          >
            <Typography sx={{ fontWeight: 650 }}>No GPS positions in this period</Typography>
            <Typography color="text.secondary" variant="body2">
              Pick another date, or check that the vehicle was tracking at that time.
            </Typography>
          </Stack>
        </Box>
      )}

      {route && hasPoints && (
        <Stack spacing={1.5} sx={{ ...pad, pt: 2, pb: 2 }}>
          {route.truncated && (
            <Alert severity="info">
              This period has more than {MAX_ROUTE_POINTS.toLocaleString()} positions, so only the
              most recent ones are shown. Pick a shorter period to see where it started.
            </Alert>
          )}
          <RouteMap points={driven} current={current} />
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={2}
            sx={{ alignItems: { md: 'center' }, justifyContent: 'space-between' }}
          >
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ alignItems: 'center', flex: 1, maxWidth: { md: '60%' } }}
            >
              <Tooltip title={playing ? 'Pause' : 'Replay the route'}>
                <IconButton
                  aria-label={playing ? 'Pause replay' : 'Replay the route'}
                  color="primary"
                  onClick={() => {
                    if (!playing && index >= lastIndex) setIndex(0);
                    setPlaying((value) => !value);
                  }}
                >
                  {playing ? <Pause size={20} /> : <Play size={20} />}
                </IconButton>
              </Tooltip>
              <Slider
                aria-label="Position along the route"
                max={lastIndex}
                min={0}
                value={index}
                onChange={(_, value: number | number[]) => {
                  setPlaying(false);
                  setIndex(typeof value === 'number' ? value : (value[0] ?? 0));
                }}
              />
              <ToggleButtonGroup
                aria-label="Replay speed"
                exclusive
                size="small"
                value={speed}
                onChange={(_, value: number | null) => {
                  if (value) setSpeed(value);
                }}
              >
                {replaySpeeds.map((value) => (
                  <ToggleButton key={value} value={value}>
                    {value}×
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>

            <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap' }}>
              {(Object.keys(downloads) as Array<keyof typeof downloads>).map((kind) => (
                <Button
                  key={kind}
                  color="inherit"
                  disabled={!hasPoints}
                  onClick={() => download(kind)}
                  size="small"
                  startIcon={<Download size={14} />}
                  variant="outlined"
                  sx={{
                    flex: { xs: 1, sm: 'none' },
                    minHeight: 32,
                    fontSize: 11,
                    borderColor: '#DCE2EB',
                    color: '#39445A',
                  }}
                >
                  {downloads[kind].label}
                </Button>
              ))}
            </Stack>
          </Stack>
        </Stack>
      )}

      {notices.map((notice) => (
        <Typography
          key={notice}
          color="text.secondary"
          sx={{
            ...pad,
            py: 1.25,
            fontSize: 11,
            bgcolor: '#F8FAFF',
            borderTop: `1px solid ${panelBorder}`,
          }}
        >
          {notice}
        </Typography>
      ))}
    </Panel>
  );
}

function startOfDay(offsetDays: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date.getTime();
}

/** Value for <input type="datetime-local">, in the browser's time zone. */
function toLocalInput(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function fromLocalInput(value: string) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}
