import type {
  ActivityEntry,
  Device,
  FleetAlert,
  IssueKind,
  PauseReason,
  WarningKind,
} from '@trackify/api-client';
import { noGpsSince, statusLabels, vehicleStatus } from './fleet-map-data';

export const pauseLabels: Record<PauseReason, string> = {
  break: 'Break',
  fuel: 'Fuel stop',
  loading: 'Loading / unloading',
  personal: 'Personal',
};

export const issueLabels: Record<IssueKind, string> = {
  breakdown: 'Breakdown',
  'flat-tyre': 'Flat tyre',
  accident: 'Accident',
  traffic: 'Traffic / delay',
  other: 'Other issue',
};

export const warningLabels: Record<WarningKind, string> = {
  'battery-low': 'Phone battery low',
  'gps-off': 'Location turned off on the phone',
  'permission-revoked': 'Location permission removed on the phone',
  'tracking-stopped': 'Tracking stopped on the phone',
  'phone-left-vehicle': 'Phone left the vehicle (driver walking with it)',
};

const time = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

/** What the driver last said about their shift; undefined if they never used the driver app. */
export function dutyLabel(device: Device): string | undefined {
  if (device.dutyStatus === 'on') return 'On shift';
  if (device.dutyStatus === 'off') return 'Off duty';
  if (device.dutyStatus === 'paused') {
    const reason = device.pauseReason ? pauseLabels[device.pauseReason] : 'Paused';
    return device.pauseUntil
      ? `Paused · ${reason} · until ${time(device.pauseUntil)}`
      : `Paused · ${reason}`;
  }
  return undefined;
}

/**
 * Silent this long while "on shift": the driver almost certainly forgot to end the shift (or the
 * phone died overnight). Still worth showing, but no longer an alarm.
 */
export const STALE_SHIFT_MS = 12 * 3_600_000;

/** Since when an on-shift vehicle has been silent: last contact, else the shift start. */
function silentSince(device: Device) {
  return Math.max(device.state?.lastSeenAt ?? 0, device.dutySince ?? 0);
}

/**
 * On shift but silent: Android stopped the app, the phone died or has no internet. A phone
 * without GPS still checks in, so this means the phone itself cannot be reached. A shift silent
 * for 12 hours or more was most likely never ended, so it no longer counts.
 */
export function notReporting(device: Device, now = Date.now()) {
  return (
    device.dutyStatus === 'on' &&
    vehicleStatus(device, now) === 'offline' &&
    now - silentSince(device) < STALE_SHIFT_MS
  );
}

export type PresenceTone = 'moving' | 'parked' | 'critical' | 'warning' | 'muted';

/**
 * One status for a vehicle, in words, combining whether it is reporting with what the driver
 * said about their shift, so the dashboard never shows "Offline" next to "On shift".
 */
export function presence(device: Device, now = Date.now()): { label: string; tone: PresenceTone } {
  const status = vehicleStatus(device, now);
  const duty = device.dutyStatus;
  if (status === 'offline') {
    if (duty === 'on') {
      if (notReporting(device, now)) return { label: 'Not reachable · on shift', tone: 'critical' };
      return { label: 'Offline · shift not ended', tone: 'muted' };
    }
    if (duty === 'paused') return { label: 'Offline · paused', tone: 'muted' };
    if (duty === 'off') return { label: 'Offline · off duty', tone: 'muted' };
    return { label: 'Offline', tone: 'muted' };
  }
  if (noGpsSince(device, now) !== undefined)
    return { label: 'Online · no GPS signal', tone: 'warning' };
  const shift = duty === 'on' ? 'on shift' : duty === 'off' ? 'off duty' : dutyLabel(device);
  return {
    label: shift ? `${statusLabels[status]} · ${shift}` : statusLabels[status],
    tone: status,
  };
}

export type Tone = 'critical' | 'warning' | 'info' | 'success';

/** One timeline row: what happened, in words, and how loudly to show it. */
export function describeActivity(entry: ActivityEntry): {
  title: string;
  detail?: string;
  tone: Tone;
} {
  switch (entry.type) {
    case 'shift-start':
      return { title: 'Started shift', tone: 'success' };
    case 'shift-end':
      return { title: 'Ended shift', tone: 'info' };
    case 'pause':
      return {
        title: `Left the vehicle · ${entry.reason ? pauseLabels[entry.reason] : 'pause'}`,
        detail: entry.until ? `Sharing resumes by ${time(entry.until)} at the latest` : undefined,
        tone: 'info',
      };
    case 'resume':
      return {
        title: entry.auto ? 'Pause limit reached · sharing resumed' : 'Back in the vehicle',
        tone: entry.auto ? 'warning' : 'success',
      };
    case 'sos':
      return { title: 'SOS emergency', detail: entry.note, tone: 'critical' };
    case 'issue':
      return {
        title: `Reported: ${entry.kind ? issueLabels[entry.kind as IssueKind] : 'issue'}`,
        detail: entry.note,
        tone: entry.kind === 'accident' || entry.kind === 'breakdown' ? 'critical' : 'warning',
      };
    case 'fuel':
      return {
        title: `Fuel: ${entry.litres ?? '?'} L`,
        detail:
          [
            entry.amount !== undefined && `₹${entry.amount.toLocaleString('en-IN')}`,
            entry.odometerKm !== undefined &&
              `odometer ${entry.odometerKm.toLocaleString('en-IN')} km`,
            entry.note,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: 'info',
      };
    case 'check': {
      const problems = Object.entries(entry.items ?? {})
        .filter(([, result]) => result === 'issue')
        .map(([item]) => item);
      return {
        title: problems.length ? 'Vehicle check · problems found' : 'Vehicle check · all OK',
        detail:
          [problems.length ? `Problem: ${problems.join(', ')}` : '', entry.note ?? '']
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: problems.length ? 'warning' : 'success',
      };
    }
    case 'warning':
      return {
        title: entry.kind ? warningLabels[entry.kind as WarningKind] : 'Phone warning',
        detail: entry.batteryPct !== undefined ? `Battery ${entry.batteryPct}%` : undefined,
        tone: 'warning',
      };
    case 'message':
      return {
        title: `Message sent${entry.sentBy ? ` by ${entry.sentBy}` : ''}`,
        detail: entry.text,
        tone: 'info',
      };
    case 'driver-change':
      return {
        title: 'Driver changed',
        detail: `${entry.previousDriverName ?? 'No driver'} → ${entry.driverName ?? 'No driver'}${
          entry.sentBy ? ` · by ${entry.sentBy}` : ''
        }`,
        tone: 'info',
      };
  }
}

export type ActivityTab = 'driver' | 'vehicle';

const tabTypes: Record<ActivityTab, ReadonlySet<ActivityEntry['type']>> = {
  // What the driver did with their shift, and who the driver was.
  driver: new Set(['shift-start', 'shift-end', 'pause', 'resume', 'driver-change']),
  // What happened to the vehicle: reports, fuel, checks, phone problems, SOS and driver changes.
  vehicle: new Set(['sos', 'issue', 'fuel', 'check', 'warning', 'driver-change']),
};

/** Whether an entry belongs in a tab. Alerts sent to the driver are in neither: see Send alert. */
export function inTab(entry: Pick<ActivityEntry, 'type'>, tab: ActivityTab) {
  return tabTypes[tab].has(entry.type);
}

/** Who was driving when it happened. */
export function driverOf(entry: Pick<ActivityEntry, 'driverName'>) {
  return entry.driverName ?? 'No driver assigned';
}

export function alertTitle(alert: Pick<FleetAlert, 'type' | 'kind'>): string {
  if (alert.type === 'sos') return 'SOS emergency';
  if (alert.type === 'issue')
    return alert.kind ? issueLabels[alert.kind as IssueKind] : 'Issue reported';
  if (alert.type === 'warning')
    return alert.kind ? warningLabels[alert.kind as WarningKind] : 'Phone warning';
  return 'Alert';
}

export function intervalLabel(seconds: number) {
  return seconds < 60 ? `${seconds} seconds` : `${seconds / 60} min`;
}

export function mapLink(latitude?: number, longitude?: number) {
  return latitude !== undefined && longitude !== undefined
    ? `https://maps.google.com/?q=${latitude},${longitude}`
    : undefined;
}
