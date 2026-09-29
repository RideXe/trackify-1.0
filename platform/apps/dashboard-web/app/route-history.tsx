'use client';

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Paper,
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
  type LoadedRoute,
} from './route-data';
import { RouteMap } from './route-map';

interface Period {
  from: number;
  to: number;
}

const today = { label: 'Today', period: () => ({ from: startOfDay(0), to: Date.now() }) };
const presets: Array<{ label: string; period: () => Period }> = [
  today,
  { label: 'Yesterday', period: () => ({ from: startOfDay(-1), to: startOfDay(0) - 1 }) },
  { label: 'Last 24 hours', period: () => ({ from: Date.now() - 86_400_000, to: Date.now() }) },
  { label: 'Last 7 days', period: () => ({ from: startOfDay(-6), to: Date.now() }) },
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
  const current = points[index];
  const lastIndex = Math.max(points.length - 1, 0);

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
        ? routeToKml(title, route.points)
        : kind === 'gpx'
          ? routeToGpx(title, route.points)
          : routeToCsv(route.points);
    const url = URL.createObjectURL(new Blob([content], { type: downloads[kind].type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = routeFileName(device.name, route.from, route.to, kind);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const now = Date.now();
  const invalidPeriod = period.from >= period.to || period.from > now;

  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack spacing={2.5}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { md: 'center' } }}
        >
          <Box>
            <Typography sx={{ fontWeight: 700 }}>Route history</Typography>
            <Typography color="text.secondary" variant="caption">
              Where {device.name} went in a chosen period. Positions are kept for 90 days.
            </Typography>
          </Box>
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
            {presets.map(({ label, period: next }) => (
              <Chip
                key={label}
                label={label}
                color={preset === label ? 'primary' : 'default'}
                variant={preset === label ? 'filled' : 'outlined'}
                onClick={() => choose(label, next())}
              />
            ))}
          </Stack>
        </Stack>

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' } }}
        >
          {(['from', 'to'] as const).map((edge) => (
            <TextField
              key={edge}
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
              loading ? <CircularProgress color="inherit" size={16} /> : <History size={17} />
            }
            variant="contained"
          >
            {loading ? 'Loading…' : 'Show route'}
          </Button>
        </Stack>

        {loading && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}

        {route && !loading && !route.points.length && (
          <Stack
            spacing={0.75}
            sx={{
              minHeight: 180,
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: '#F9FAFB',
              borderRadius: 2,
              textAlign: 'center',
              px: 2,
            }}
          >
            <Typography sx={{ fontWeight: 650 }}>No GPS positions in this period</Typography>
            <Typography color="text.secondary" variant="body2">
              Pick another date, or check that the vehicle was tracking at that time.
            </Typography>
          </Stack>
        )}

        {route && route.points.length > 0 && (
          <>
            {route.truncated && (
              <Alert severity="info">
                This period has more than {MAX_ROUTE_POINTS.toLocaleString()} positions, so only the
                most recent ones are shown. Pick a shorter period to see where it started.
              </Alert>
            )}
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 3 }}>
              {[
                ['Distance', `${(summary.distanceM / 1000).toFixed(1)} km`],
                ['Duration', formatDuration(summary.durationMs)],
                ['Top speed', `${Math.round(summary.maxSpeedKmh)} km/h`],
                ['GPS points', route.points.length.toLocaleString()],
              ].map(([label, value]) => (
                <Box key={label} sx={{ minWidth: 110 }}>
                  <Typography color="text.secondary" variant="caption">
                    {label}
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
                </Box>
              ))}
            </Stack>

            <RouteMap points={route.points} current={current} />

            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ alignItems: { md: 'center' } }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flex: 1 }}>
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
              </Stack>
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
            {current && (
              <Typography color="text.secondary" variant="body2">
                {new Date(current.fixTime).toLocaleString()} · {Math.round(current.speedKmh ?? 0)}{' '}
                km/h · {current.latitude.toFixed(5)}, {current.longitude.toFixed(5)}
              </Typography>
            )}
            {route.skipped > 0 && (
              <Typography color="text.secondary" variant="caption">
                {route.skipped.toLocaleString()} positions reported without a GPS lock are not
                shown.
              </Typography>
            )}

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              sx={{ alignItems: { sm: 'center' } }}
            >
              <Typography variant="body2" sx={{ fontWeight: 650, mr: 1 }}>
                Download route
              </Typography>
              {(Object.keys(downloads) as Array<keyof typeof downloads>).map((kind) => (
                <Button
                  key={kind}
                  onClick={() => download(kind)}
                  size="small"
                  startIcon={<Download size={16} />}
                  variant="outlined"
                >
                  {downloads[kind].label}
                </Button>
              ))}
            </Stack>
          </>
        )}
      </Stack>
    </Paper>
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
