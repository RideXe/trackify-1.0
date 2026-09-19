import { z } from 'zod';
import { alarmTypeSchema, entityIdSchema, epochMsSchema, ioValuesSchema } from './position';

/**
 * Event types. The legacy Traccar-based set is kept for compatibility; `tripStarted` and
 * `tripEnded` are new and come from live trip detection.
 */
export const eventTypeSchema = z.enum([
  'deviceOnline',
  'deviceOffline',
  'deviceUnknown',
  'deviceInactive',
  'deviceMoving',
  'deviceStopped',
  'deviceOverspeed',
  'deviceFuelDrop',
  'deviceFuelIncrease',
  'ignitionOn',
  'ignitionOff',
  'geofenceEnter',
  'geofenceExit',
  'proximityEnter',
  'proximityExit',
  'unaccompaniedMotion',
  'alarm',
  'commandResult',
  'queuedCommandSent',
  'maintenance',
  'driverChanged',
  'media',
  'tripStarted',
  'tripEnded',
]);
export type EventType = z.infer<typeof eventTypeSchema>;

const GEOFENCE_EVENT_TYPES: ReadonlySet<EventType> = new Set(['geofenceEnter', 'geofenceExit']);

export const EVENT_MESSAGE_VERSION = 1;

export const eventMessageSchema = z
  .object({
    v: z.literal(EVENT_MESSAGE_VERSION),
    eventId: entityIdSchema,
    tenantId: entityIdSchema,
    deviceId: entityIdSchema,
    type: eventTypeSchema,
    eventTime: epochMsSchema,
    /** Fix time of the position that triggered the event, when there is one. */
    positionFixTime: epochMsSchema.optional(),
    geofenceId: entityIdSchema.optional(),
    alarm: alarmTypeSchema.optional(),
    attributes: ioValuesSchema.default({}),
  })
  .refine((event) => event.type !== 'alarm' || event.alarm !== undefined, {
    error: 'alarm events must include the alarm type',
    path: ['alarm'],
  })
  .refine((event) => !GEOFENCE_EVENT_TYPES.has(event.type) || event.geofenceId !== undefined, {
    error: 'geofence events must include the geofence id',
    path: ['geofenceId'],
  });
export type EventMessageInput = z.input<typeof eventMessageSchema>;
export type EventMessage = z.output<typeof eventMessageSchema>;

export function parseEventMessage(input: unknown) {
  return eventMessageSchema.safeParse(input);
}
