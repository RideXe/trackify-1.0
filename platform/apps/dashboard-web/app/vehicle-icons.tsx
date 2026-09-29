'use client';

import { Avatar, Box, ButtonBase, Typography } from '@mui/material';
import { vehicleTypes, type VehicleType } from '@trackify/api-client';
import {
  Ambulance,
  Bus,
  BusFront,
  Car,
  CarTaxiFront,
  Container,
  MapPin,
  Motorbike,
  Scooter,
  Tractor,
  Truck,
  Van,
  type LucideIcon,
} from 'lucide-react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

/** One list drives the vehicle list, details, type picker and map pins. */
export const vehicleIcons: Record<VehicleType, { label: string; Icon: LucideIcon }> = {
  car: { label: 'Car', Icon: Car },
  taxi: { label: 'Taxi', Icon: CarTaxiFront },
  motorbike: { label: 'Motorbike', Icon: Motorbike },
  scooter: { label: 'Scooter', Icon: Scooter },
  van: { label: 'Van', Icon: Van },
  truck: { label: 'Truck', Icon: Truck },
  bus: { label: 'Bus', Icon: Bus },
  schoolBus: { label: 'School bus', Icon: BusFront },
  tractor: { label: 'Tractor', Icon: Tractor },
  ambulance: { label: 'Ambulance', Icon: Ambulance },
  asset: { label: 'Asset', Icon: Container },
  other: { label: 'Other', Icon: MapPin },
};

export function VehicleAvatar({
  type = 'car',
  size = 40,
  color = '#155EEF',
  background = '#EEF4FF',
}: {
  type?: VehicleType;
  size?: number;
  color?: string;
  background?: string;
}) {
  const { Icon, label } = vehicleIcons[type];
  return (
    <Avatar aria-label={label} sx={{ width: size, height: size, bgcolor: background, color }}>
      <Icon size={Math.round(size * 0.5)} />
    </Avatar>
  );
}

export function VehicleTypePicker({
  value,
  onChange,
  disabled,
}: {
  value: VehicleType;
  onChange: (type: VehicleType) => void;
  disabled?: boolean;
}) {
  return (
    <Box
      role="radiogroup"
      aria-label="Vehicle type"
      sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 1 }}
    >
      {vehicleTypes.map((type) => {
        const selected = type === value;
        return (
          <ButtonBase
            key={type}
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(type)}
            sx={{
              flexDirection: 'column',
              gap: 0.75,
              py: 1.25,
              borderRadius: 2,
              border: 1,
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? '#EEF4FF' : 'transparent',
            }}
          >
            <VehicleAvatar
              type={type}
              color={selected ? '#FFFFFF' : '#155EEF'}
              background={selected ? '#155EEF' : '#EEF4FF'}
            />
            <Typography variant="caption" sx={{ fontWeight: selected ? 700 : 500 }}>
              {vehicleIcons[type].label}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}

/**
 * SVG markup for an icon, used to draw map pins. Rendered with React's public API, so call it from
 * an event or callback, never while React is rendering.
 */
export function iconSvg(Icon: LucideIcon, color: string, strokeWidth = 2): string {
  const element = document.createElement('div');
  const root = createRoot(element);
  flushSync(() => root.render(createElement(Icon, { size: 24, color, strokeWidth })));
  const markup = element.innerHTML;
  root.unmount();
  return markup;
}
