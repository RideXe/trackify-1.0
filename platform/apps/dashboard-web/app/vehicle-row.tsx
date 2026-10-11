'use client';

import { Box, Chip, ListItemButton, Stack, Typography } from '@mui/material';
import { toVehicleType, type Device } from '@trackify/api-client';
import { ChevronRight } from 'lucide-react';
import { presence, type PresenceTone } from './driver-activity-data';
import { statusColors, timeAgo, vehicleStatus } from './fleet-map-data';
import { VehicleAvatar, vehicleIcons } from './vehicle-icons';

/** Status dot colour, matching the vehicle page's badge. */
export const presenceDot: Record<PresenceTone, string> = {
  moving: statusColors.moving,
  parked: statusColors.parked,
  critical: '#D92D20',
  warning: '#DC6803',
  muted: '#98A2B3',
};

/**
 * One vehicle in a list (Overview, Live map): its icon with a status dot, name, one line of
 * status, and when it was last heard from.
 */
export function VehicleRow({
  device,
  alert = false,
  selected = false,
  onClick,
}: {
  device: Device;
  /** Has an open alert. */
  alert?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  const now = presence(device);
  const seen = device.state?.lastSeenAt;
  const type = toVehicleType(device.vehicleType);
  return (
    <ListItemButton
      selected={selected}
      onClick={onClick}
      sx={{ px: 2, py: 1.25, gap: 1.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Box sx={{ position: 'relative', flexShrink: 0 }}>
        <VehicleAvatar
          type={type}
          color={statusColors[vehicleStatus(device)]}
          background="#F2F4F7"
        />
        <Box
          sx={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: 11,
            height: 11,
            borderRadius: '50%',
            bgcolor: presenceDot[now.tone],
            border: '2px solid #FFFFFF',
          }}
        />
      </Box>
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography noWrap sx={{ fontWeight: 700, fontSize: 14, minWidth: 0 }}>
            {device.name}
          </Typography>
          {alert && (
            <Chip color="error" label="Alert" size="small" sx={{ height: 18, fontSize: 10 }} />
          )}
        </Stack>
        <Typography noWrap color="text.secondary" sx={{ fontSize: 12 }}>
          {[
            vehicleIcons[type].label,
            now.label,
            vehicleStatus(device) === 'moving' && `${Math.round(device.state?.speedKmh ?? 0)} km/h`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      </Box>
      <Typography color="text.secondary" sx={{ fontSize: 11, flexShrink: 0, textAlign: 'right' }}>
        {seen ? timeAgo(seen) : 'never'}
      </Typography>
      <ChevronRight size={16} color="#98A2B3" />
    </ListItemButton>
  );
}
