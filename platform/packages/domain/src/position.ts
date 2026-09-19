import { z } from 'zod';

/**
 * Entity IDs are ULIDs: 26 Crockford base32 characters, time-sortable (see ADR 0003).
 */
export const entityIdSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'must be a ULID (26 Crockford base32 characters)');

/** Unix epoch time in milliseconds. */
export const epochMsSchema = z.number().int().nonnegative();

/** Where a position entered the platform. */
export const positionSourceSchema = z.enum(['gateway', 'http', 'iot']);
export type PositionSource = z.infer<typeof positionSourceSchema>;

/**
 * Alarm codes reported by trackers. Kept identical to the legacy Traccar-based server
 * so decoders and stored data stay compatible.
 */
export const alarmTypeSchema = z.enum([
  'general',
  'sos',
  'vibration',
  'movement',
  'lowspeed',
  'overspeed',
  'fallDown',
  'lowPower',
  'lowBattery',
  'fault',
  'powerOff',
  'powerOn',
  'door',
  'lock',
  'unlock',
  'geofence',
  'geofenceEnter',
  'geofenceExit',
  'gpsAntennaCut',
  'accident',
  'tow',
  'idle',
  'highRpm',
  'hardAcceleration',
  'hardBraking',
  'hardCornering',
  'laneChange',
  'fatigueDriving',
  'powerCut',
  'powerRestored',
  'jamming',
  'temperature',
  'parking',
  'bonnet',
  'footBrake',
  'fuelLeak',
  'tampering',
  'removing',
]);
export type AlarmType = z.infer<typeof alarmTypeSchema>;

/** Free-form protocol-specific values (IO elements, sensor readings). */
export const ioValuesSchema = z.record(z.string(), z.union([z.number(), z.string(), z.boolean()]));

/** Well-known values decoded from tracker messages. Protocol-specific extras go in `io`. */
export const positionAttributesSchema = z.object({
  ignition: z.boolean().optional(),
  motion: z.boolean().optional(),
  alarms: z.array(alarmTypeSchema).optional(),
  batteryLevelPct: z.number().min(0).max(100).optional(),
  batteryV: z.number().nonnegative().optional(),
  powerV: z.number().nonnegative().optional(),
  charging: z.boolean().optional(),
  odometerM: z.number().nonnegative().optional(),
  engineHoursS: z.number().nonnegative().optional(),
  fuelLevelPct: z.number().min(0).max(100).optional(),
  satellites: z.number().int().nonnegative().optional(),
  hdop: z.number().nonnegative().optional(),
  rssi: z.number().optional(),
  driverUniqueId: z.string().min(1).max(64).optional(),
  io: ioValuesSchema.optional(),
});
export type PositionAttributes = z.infer<typeof positionAttributesSchema>;

export const POSITION_MESSAGE_VERSION = 1;

/**
 * A normalized position, as placed on the ingest queue by the gateway, phone ingest, or IoT ingest.
 *
 * Unknown fields are stripped (not rejected) so a newer producer never poisons an older consumer.
 */
export const positionMessageSchema = z.object({
  v: z.literal(POSITION_MESSAGE_VERSION),
  /** Unique per received record; used for queue de-duplication. */
  ingestId: z.string().min(1).max(128),
  /** Stable for a physical tracker message across retransmissions. */
  messageId: z.string().min(16).max(128),
  tenantId: entityIdSchema,
  deviceId: entityIdSchema,
  /** Identifier reported by the tracker itself (IMEI for most hardware). */
  uniqueId: z.string().min(1).max(64),
  protocol: z.string().min(1).max(32),
  source: positionSourceSchema,
  retentionDays: z.number().int().min(1).max(3_650).default(90),
  receivedAt: epochMsSchema,
  fixTime: epochMsSchema,
  valid: z.boolean(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitudeM: z.number().min(-1_000).max(100_000).optional(),
  speedKmh: z.number().min(0).max(1_500).optional(),
  courseDeg: z.number().min(0).max(360).optional(),
  accuracyM: z.number().nonnegative().optional(),
  attributes: positionAttributesSchema.default({}),
});
export type PositionMessageInput = z.input<typeof positionMessageSchema>;
export type PositionMessage = z.output<typeof positionMessageSchema>;

export function parsePositionMessage(input: unknown) {
  return positionMessageSchema.safeParse(input);
}

/**
 * Key that identifies one physical fix of one device. Stored positions are written with this key,
 * so a retried or duplicated message overwrites itself instead of creating a second point.
 */
export function positionDedupeKey(
  position: Pick<PositionMessage, 'deviceId' | 'fixTime' | 'messageId'>,
): string {
  return `${position.deviceId}#${position.fixTime}#${position.messageId}`;
}

const KMH_PER_KNOT = 1.852;

/** Most tracker protocols report speed in knots; the platform stores km/h. */
export function knotsToKmh(knots: number): number {
  return Math.round(knots * KMH_PER_KNOT * 100) / 100;
}
