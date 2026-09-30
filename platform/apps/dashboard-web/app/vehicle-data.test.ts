import type { Device, Driver } from '@trackify/api-client';
import { describe, expect, it } from 'vitest';
import {
  assignedDriver,
  detailChanges,
  detailsForm,
  driverChanges,
  driverForm,
  driverFormError,
  driverInput,
  formatCalendarDay,
  initials,
  telHref,
  todayCalendarDay,
  vehiclesByDriver,
} from './vehicle-data';

function vehicle(extra: Partial<Device> = {}): Device {
  return {
    deviceId: 'device-1',
    name: 'KA 01 AB 1234',
    uniqueId: 'phone-1',
    protocol: 'osmand',
    groupId: 'UNGROUPED',
    ...extra,
  };
}

const ramesh: Driver = { driverId: 'driver-1', name: 'Ramesh Kumar', phone: '+91 98450 12345' };

describe('vehicle details form', () => {
  it('starts blank for details nobody has entered, never with a guess', () => {
    expect(detailsForm(vehicle())).toEqual({
      name: 'KA 01 AB 1234',
      vehicleType: 'car',
      model: '',
      fuelType: '',
      purchasedOn: '',
      colour: '',
    });
  });

  it('sends nothing when nothing changed', () => {
    const device = vehicle({ model: 'Innova', colour: 'White' });
    expect(detailChanges(device, detailsForm(device))).toEqual({});
  });

  it('sends only what changed, and null for a field that was emptied', () => {
    const device = vehicle({ model: 'Innova', colour: 'White' });
    const form = {
      ...detailsForm(device),
      model: '  Innova Crysta ',
      colour: '',
      fuelType: 'diesel' as const,
    };
    expect(detailChanges(device, form)).toEqual({
      model: 'Innova Crysta',
      colour: null,
      fuelType: 'diesel',
    });
  });

  it('ignores a blank vehicle name instead of clearing it', () => {
    expect(detailChanges(vehicle(), { ...detailsForm(vehicle()), name: '   ' })).toEqual({});
  });
});

describe('driver form', () => {
  it('requires a name and a plausible phone number', () => {
    expect(driverFormError(driverForm())).toBeDefined();
    expect(driverFormError({ ...driverForm(), name: 'Ramesh', phone: '12' })).toBeDefined();
    expect(driverFormError({ ...driverForm(), name: 'Ramesh' })).toBeUndefined();
  });

  it('leaves blank details out of a new driver', () => {
    expect(driverInput({ name: ' Ramesh ', phone: ' ', licenceNumber: '' })).toEqual({
      name: 'Ramesh',
    });
  });

  it('clears a detail that was emptied when editing', () => {
    expect(driverChanges(ramesh, { ...driverForm(ramesh), phone: '' })).toEqual({ phone: null });
    expect(driverChanges(ramesh, driverForm(ramesh))).toEqual({});
  });
});

describe('driver assignments', () => {
  it('treats a removed driver the same as nobody assigned', () => {
    expect(assignedDriver(vehicle({ driverId: 'driver-1' }), [ramesh])).toBe(ramesh);
    expect(assignedDriver(vehicle({ driverId: 'removed' }), [ramesh])).toBeUndefined();
    expect(assignedDriver(vehicle(), [ramesh])).toBeUndefined();
  });

  it('groups vehicles under the driver they are assigned to', () => {
    const byDriver = vehiclesByDriver([
      vehicle({ deviceId: 'a', driverId: 'driver-1' }),
      vehicle({ deviceId: 'b' }),
      vehicle({ deviceId: 'c', driverId: 'driver-1' }),
    ]);
    expect(byDriver.get('driver-1')?.map((device) => device.deviceId)).toEqual(['a', 'c']);
    expect(byDriver.size).toBe(1);
  });
});

describe('display helpers', () => {
  it('builds avatar initials and dialable phone links', () => {
    expect(initials('  ramesh   kumar singh')).toBe('RK');
    expect(initials('Anita')).toBe('A');
    expect(telHref('+91 98450-12345')).toBe('tel:+919845012345');
  });

  it('shows a purchase date as the calendar day that was entered', () => {
    expect(formatCalendarDay('2024-02-29')).toMatch(/29.*Feb.*2024/);
    expect(todayCalendarDay(new Date(2026, 8, 5))).toBe('2026-09-05');
  });
});
