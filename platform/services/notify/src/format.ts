import type { EventType } from '@trackify/domain';

/** Everything a message can mention; only the event and vehicle are always known. */
export interface MessageContext {
  type: EventType;
  eventTime: number;
  deviceName: string;
  timeZone: string;
  alarm?: string;
  geofenceName?: string;
  driverName?: string;
  maintenanceName?: string;
  speedKmh?: number;
  speedLimitKmh?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  /** commandResult text, fuel change in litres, media type… */
  detail?: string;
  dashboardUrl?: string;
}

export interface Message {
  /** Email subject, push title. */
  title: string;
  /** One line for SMS, push, Telegram and WhatsApp. */
  text: string;
  html: string;
}

/** Ported from the legacy notification templates, one sentence per event type. */
export function formatMessage(context: MessageContext): Message {
  const what = describe(context);
  const time = formatTime(context.eventTime, context.timeZone);
  const place =
    context.address ??
    (context.latitude !== undefined && context.longitude !== undefined
      ? `${context.latitude.toFixed(5)}, ${context.longitude.toFixed(5)}`
      : undefined);
  const mapUrl =
    context.latitude !== undefined && context.longitude !== undefined
      ? `https://www.google.com/maps?q=${context.latitude},${context.longitude}`
      : undefined;
  const text = `${context.deviceName} ${what.sentence} at ${time}${place ? ` — ${place}` : ''}`;
  const rows = [
    ['Vehicle', context.deviceName],
    [what.label, what.value],
    ['Time', time],
    ...(place ? [['Location', mapUrl ? link(mapUrl, place) : escape(place)]] : []),
  ];
  const html = [
    '<!DOCTYPE html><html><body>',
    ...rows.map(
      ([label, value]) =>
        `${escape(label ?? '')}: ${label === 'Location' ? value : escape(value ?? '')}<br>`,
    ),
    context.dashboardUrl ? `<br>${link(context.dashboardUrl, 'Open Trackify')}` : '',
    '</body></html>',
  ].join('\n');
  return { title: `${context.deviceName}: ${what.title}`, text, html };
}

interface Description {
  title: string;
  sentence: string;
  label: string;
  value: string;
}

function describe(context: MessageContext): Description {
  const speed =
    context.speedKmh !== undefined ? `${context.speedKmh.toFixed(1)} km/h` : 'the limit';
  const limit = context.speedLimitKmh !== undefined ? ` (limit ${context.speedLimitKmh} km/h)` : '';
  const geofence = context.geofenceName ?? 'a geofence';
  const status = (title: string, sentence = title): Description => ({
    title,
    sentence,
    label: 'Status',
    value: capitalise(title),
  });
  switch (context.type) {
    case 'alarm': {
      const name = alarmName(context.alarm);
      return { title: 'alarm!', sentence: `alarm: ${name}`, label: 'Alarm', value: name };
    }
    case 'deviceOverspeed':
      return {
        title: 'exceeds the speed',
        sentence: `exceeds the speed: ${speed}${limit}${context.geofenceName ? ` in ${context.geofenceName}` : ''}`,
        label: 'Speed',
        value: `${speed}${limit}`,
      };
    case 'geofenceEnter':
      return {
        title: 'has entered geofence',
        sentence: `has entered geofence ${geofence}`,
        label: 'Geofence',
        value: geofence,
      };
    case 'geofenceExit':
      return {
        title: 'has exited geofence',
        sentence: `has exited geofence ${geofence}`,
        label: 'Geofence',
        value: geofence,
      };
    case 'proximityEnter':
      return {
        title: 'is near another vehicle',
        sentence: `came close to ${context.detail ?? 'another vehicle'}`,
        label: 'Near',
        value: context.detail ?? 'another vehicle',
      };
    case 'proximityExit':
      return {
        title: 'moved away',
        sentence: `moved away from ${context.detail ?? 'another vehicle'}`,
        label: 'Away from',
        value: context.detail ?? 'another vehicle',
      };
    case 'ignitionOn':
      return status('ignition on');
    case 'ignitionOff':
      return status('ignition off');
    case 'deviceOnline':
      return status('online');
    case 'deviceOffline':
      return status('offline');
    case 'deviceUnknown':
      return status('status unknown');
    case 'deviceInactive':
      return status('inactive', 'has been inactive');
    case 'deviceMoving':
      return status('moving', 'started moving');
    case 'deviceStopped':
      return status('stopped');
    case 'tripStarted':
      return status('trip started', 'started a trip');
    case 'tripEnded':
      return status('trip ended', 'ended a trip');
    case 'unaccompaniedMotion':
      return status('moving unaccompanied', 'is moving unaccompanied');
    case 'deviceFuelDrop':
      return {
        title: 'fuel drop',
        sentence: `fuel dropped${context.detail ? ` by ${context.detail}` : ''}`,
        label: 'Fuel drop',
        value: context.detail ?? 'detected',
      };
    case 'deviceFuelIncrease':
      return {
        title: 'fuel increase',
        sentence: `fuel increased${context.detail ? ` by ${context.detail}` : ''}`,
        label: 'Fuel increase',
        value: context.detail ?? 'detected',
      };
    case 'driverChanged': {
      const driver = context.driverName ?? context.detail ?? 'unknown driver';
      return {
        title: 'driver changed',
        sentence: `driver changed to ${driver}`,
        label: 'Driver',
        value: driver,
      };
    }
    case 'maintenance': {
      const name = context.maintenanceName ?? 'service';
      return {
        title: 'maintenance required',
        sentence: `needs maintenance: ${name}`,
        label: 'Maintenance',
        value: name,
      };
    }
    case 'commandResult':
      return {
        title: 'command result',
        sentence: `replied to a command${context.detail ? `: ${context.detail}` : ''}`,
        label: 'Result',
        value: context.detail ?? '',
      };
    case 'queuedCommandSent':
      return {
        title: 'queued command sent',
        sentence: 'received a command that was waiting for it',
        label: 'Command',
        value: context.detail ?? 'sent',
      };
    case 'media':
      return {
        title: 'new media',
        sentence: `sent ${context.detail ?? 'a photo or video'}`,
        label: 'Media',
        value: context.detail ?? 'received',
      };
  }
}

/** `lowBattery` → `Low battery`; the legacy translation keys follow the same camelCase. */
export function alarmName(alarm: string | undefined) {
  if (!alarm) return 'Alarm';
  if (alarm === 'sos') return 'SOS';
  return capitalise(alarm.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

export function formatTime(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function link(url: string, label: string) {
  return `<a href="${escape(url)}">${escape(label)}</a>`;
}
