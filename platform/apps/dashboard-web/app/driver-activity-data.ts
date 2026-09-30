import type {
  ActivityEntry,
  Device,
  FleetAlert,
  IssueKind,
  PauseReason,
  WarningKind,
} from '@trackify/api-client';
import { vehicleStatus } from './fleet-map-data';

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
 * On shift but silent: the app was closed by force, the phone died or lost signal. Not raised
 * while paused, when silence is expected.
 */
export function notReporting(device: Device, now = Date.now()) {
  return device.dutyStatus === 'on' && vehicleStatus(device, now) === 'offline';
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
  }
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
