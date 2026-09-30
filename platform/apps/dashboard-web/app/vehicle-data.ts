import {
  toVehicleType,
  type Device,
  type DeviceChanges,
  type Driver,
  type DriverChanges,
  type DriverInput,
  type FuelType,
  type VehicleType,
} from '@trackify/api-client';

export const fuelLabels: Record<FuelType, string> = {
  petrol: 'Petrol',
  diesel: 'Diesel',
  cng: 'CNG',
  electric: 'Electric',
  hybrid: 'Hybrid',
  other: 'Other',
};

/** The vehicle details form. An empty string means the administrator has not entered it. */
export interface DetailsForm {
  name: string;
  vehicleType: VehicleType;
  model: string;
  fuelType: FuelType | '';
  purchasedOn: string;
  colour: string;
}

export function detailsForm(device: Device): DetailsForm {
  return {
    name: device.name,
    vehicleType: toVehicleType(device.vehicleType),
    model: device.model ?? '',
    fuelType: device.fuelType ?? '',
    purchasedOn: device.purchasedOn ?? '',
    colour: device.colour ?? '',
  };
}

/** Only what changed. A field emptied in the form is sent as null so the server clears it. */
export function detailChanges(device: Device, form: DetailsForm): DeviceChanges {
  const changes: DeviceChanges = {};
  const name = form.name.trim();
  if (name && name !== device.name) changes.name = name;
  if (form.vehicleType !== toVehicleType(device.vehicleType))
    changes.vehicleType = form.vehicleType;
  const model = changed(form.model.trim(), device.model);
  if (model !== undefined) changes.model = model;
  const fuelType = changed(form.fuelType, device.fuelType);
  if (fuelType !== undefined) changes.fuelType = fuelType;
  const purchasedOn = changed(form.purchasedOn, device.purchasedOn);
  if (purchasedOn !== undefined) changes.purchasedOn = purchasedOn;
  const colour = changed(form.colour.trim(), device.colour);
  if (colour !== undefined) changes.colour = colour;
  return changes;
}

export interface DriverForm {
  name: string;
  phone: string;
  licenceNumber: string;
}

export function driverForm(driver?: Driver): DriverForm {
  return {
    name: driver?.name ?? '',
    phone: driver?.phone ?? '',
    licenceNumber: driver?.licenceNumber ?? '',
  };
}

/** Same limits as the API, so a mistake is explained here instead of failing on save. */
export function driverFormError(form: DriverForm): string | undefined {
  if (!form.name.trim()) return "Enter the driver's name";
  const phone = form.phone.trim();
  if (phone && (phone.length < 3 || phone.length > 20))
    return 'Phone number should be 3 to 20 characters';
  return undefined;
}

/** A new driver with only what was entered; blank fields are left out, not stored empty. */
export function driverInput(form: DriverForm): DriverInput {
  const phone = form.phone.trim();
  const licenceNumber = form.licenceNumber.trim();
  return {
    name: form.name.trim(),
    ...(phone ? { phone } : {}),
    ...(licenceNumber ? { licenceNumber } : {}),
  };
}

export function driverChanges(driver: Driver, form: DriverForm): DriverChanges {
  const changes: DriverChanges = {};
  const name = form.name.trim();
  if (name && name !== driver.name) changes.name = name;
  const phone = changed(form.phone.trim(), driver.phone);
  if (phone !== undefined) changes.phone = phone;
  const licenceNumber = changed(form.licenceNumber.trim(), driver.licenceNumber);
  if (licenceNumber !== undefined) changes.licenceNumber = licenceNumber;
  return changes;
}

/** undefined when unchanged, null when it was emptied, otherwise the new value. */
function changed<T extends string>(value: T | '', current: T | undefined): T | null | undefined {
  if (value === (current ?? '')) return undefined;
  return value === '' ? null : value;
}

/** Undefined when nobody is assigned, and also when the assigned driver has since been removed. */
export function assignedDriver(device: Device, drivers: Driver[] | undefined) {
  return device.driverId
    ? drivers?.find((driver) => driver.driverId === device.driverId)
    : undefined;
}

/** The vehicles each driver is on, taken from the vehicles' own assignments. */
export function vehiclesByDriver(devices: Device[]): Map<string, Device[]> {
  const byDriver = new Map<string, Device[]>();
  for (const device of devices) {
    if (!device.driverId) continue;
    byDriver.set(device.driverId, [...(byDriver.get(device.driverId) ?? []), device]);
  }
  return byDriver;
}

/** Up to two letters for an avatar, in place of a photo we do not have. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
}

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

/** "2024-02-29" as "29 Feb 2024", read as a calendar day so no time zone can shift it. */
export function formatCalendarDay(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Today in the browser's time zone, as YYYY-MM-DD for a date input's max. */
export function todayCalendarDay(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
