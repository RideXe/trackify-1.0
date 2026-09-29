/**
 * What a tracked device is fitted to. It only changes how the vehicle is shown; tracking works the
 * same for every type. Devices saved before types existed are cars.
 */
export const vehicleTypes = [
  'car',
  'taxi',
  'motorbike',
  'scooter',
  'van',
  'truck',
  'bus',
  'schoolBus',
  'tractor',
  'ambulance',
  'asset',
  'other',
] as const;

export type VehicleType = (typeof vehicleTypes)[number];

export const defaultVehicleType: VehicleType = 'car';

export function isVehicleType(value: unknown): value is VehicleType {
  return typeof value === 'string' && (vehicleTypes as readonly string[]).includes(value);
}

/** Stored or older records without a known type are shown as the default. */
export function toVehicleType(value: unknown): VehicleType {
  return isVehicleType(value) ? value : defaultVehicleType;
}
