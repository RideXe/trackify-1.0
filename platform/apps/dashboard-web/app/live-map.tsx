'use client';

import {
  Box,
  Chip,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { toVehicleType, type Device } from '@trackify/api-client';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dutyLabel, notReporting } from './driver-activity-data';
import { FleetMap } from './fleet-map';
import { statusColors, statusLabels, timeAgo, vehicleStatus } from './fleet-map-data';
import { filterCounts, filterVehicles, liveFilters, type LiveFilter } from './fleet-views-data';
import { VehicleAvatar } from './vehicle-icons';

/**
 * The whole fleet on one large map. Picking a vehicle in the list shows it on the map; picking
 * it again (or clicking its pin) opens the vehicle page.
 */
export function LiveMap({
  devices,
  onOpenVehicle,
}: {
  devices: Device[];
  onOpenVehicle: (deviceId: string) => void;
}) {
  const [filter, setFilter] = useState<LiveFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const counts = useMemo(() => filterCounts(devices), [devices]);
  const shown = useMemo(() => filterVehicles(devices, filter, query), [devices, filter, query]);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' },
        gap: 2,
      }}
    >
      <Paper sx={{ overflow: 'hidden' }}>
        <FleetMap
          devices={shown}
          height={{ xs: 420, lg: 'calc(100vh - 150px)' }}
          selectedId={selectedId}
          onSelect={onOpenVehicle}
        />
      </Paper>
      <Paper
        sx={{
          display: 'flex',
          flexDirection: 'column',
          maxHeight: { lg: 'calc(100vh - 150px)' },
          overflow: 'hidden',
        }}
      >
        <Stack spacing={1.5} sx={{ p: 2 }}>
          <TextField
            placeholder="Search name or GPS id"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={17} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.75 }}>
            {(Object.keys(liveFilters) as LiveFilter[]).map((key) => (
              <Chip
                key={key}
                color={filter === key ? (key === 'not-reporting' ? 'error' : 'primary') : 'default'}
                label={`${liveFilters[key]} ${counts[key]}`}
                onClick={() => setFilter(key)}
                size="small"
                variant={filter === key ? 'filled' : 'outlined'}
              />
            ))}
          </Stack>
        </Stack>
        <List disablePadding sx={{ overflowY: 'auto', borderTop: 1, borderColor: 'divider' }}>
          {!shown.length && (
            <Typography color="text.secondary" sx={{ p: 2 }} variant="body2">
              No vehicles match.
            </Typography>
          )}
          {shown.map((device) => {
            const status = vehicleStatus(device);
            const selected = device.deviceId === selectedId;
            const seen = device.state?.lastSeenAt;
            return (
              <ListItemButton
                key={device.deviceId}
                selected={selected}
                onClick={() =>
                  selected ? onOpenVehicle(device.deviceId) : setSelectedId(device.deviceId)
                }
                sx={{ gap: 1.5, borderBottom: 1, borderColor: 'divider' }}
              >
                <VehicleAvatar
                  type={toVehicleType(device.vehicleType)}
                  color="#FFFFFF"
                  background={statusColors[status]}
                  size={36}
                />
                <ListItemText
                  primary={device.name}
                  secondary={[
                    status === 'moving'
                      ? `${statusLabels[status]} · ${Math.round(device.state?.speedKmh ?? 0)} km/h`
                      : statusLabels[status],
                    notReporting(device) ? 'On shift · not reporting' : dutyLabel(device),
                    seen ? timeAgo(seen) : 'no GPS yet',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  slotProps={{ primary: { sx: { fontWeight: 650 } } }}
                />
              </ListItemButton>
            );
          })}
        </List>
        {selectedId && (
          <Typography color="text.secondary" variant="caption" sx={{ p: 1.5 }}>
            Click the selected vehicle again to open its page.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
