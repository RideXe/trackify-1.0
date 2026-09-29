import { describe, expect, it } from 'vitest';
import { isVehicleType, toVehicleType, vehicleTypes } from '../src/index';

describe('vehicle types', () => {
  it('lists car first as the default', () => {
    expect(vehicleTypes[0]).toBe('car');
    expect(new Set(vehicleTypes).size).toBe(vehicleTypes.length);
  });

  it('shows devices saved without a known type as cars', () => {
    expect(toVehicleType(undefined)).toBe('car');
    expect(toVehicleType('spaceship')).toBe('car');
    expect(toVehicleType('schoolBus')).toBe('schoolBus');
  });

  it('only accepts listed types', () => {
    expect(isVehicleType('truck')).toBe(true);
    expect(isVehicleType('Truck')).toBe(false);
    expect(isVehicleType(3)).toBe(false);
  });
});
