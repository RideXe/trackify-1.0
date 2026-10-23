'use client';

import {
  Box,
  Button,
  Chip,
  Drawer,
  IconButton,
  InputBase,
  List,
  Paper,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  type Theme,
} from '@mui/material';
import { toVehicleType, type Device, type Driver, type FleetAlert } from '@trackify/api-client';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  List as ListIcon,
  PhoneCall,
  Search,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { presence } from './driver-activity-data';
import { FleetMap } from './fleet-map';
import { timeAgo, vehicleStatus } from './fleet-map-data';
import {
  overviewCounts,
  overviewFilters,
  overviewVehicles,
  type OverviewFilter,
} from './fleet-views-data';
import { assignedDriver, telHref } from './vehicle-data';
import { VehicleAvatar, vehicleIcons } from './vehicle-icons';
import { VehicleRow, presenceDot } from './vehicle-row';

const floating = {
  bgcolor: '#FFFFFF',
  borderRadius: '14px',
  boxShadow: '0 6px 20px rgba(23,32,51,.14)',
} as const;

/**
 * Every vehicle on one full-screen map. Search and the same filters as the Overview float on top;
 * the vehicle list sits on the left (a sheet on phones). Picking a vehicle, in the list or on the
 * map, centres it and shows a small card with its status and the way to its page.
 */
export function LiveMap({
  devices,
  drivers,
  alerts,
  onOpenVehicle,
}: {
  devices: Device[];
  /** Undefined while loading. */
  drivers?: Driver[];
  alerts?: FleetAlert[];
  onOpenVehicle: (deviceId: string) => void;
}) {
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('md'));
  const [filter, setFilter] = useState<OverviewFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  // Undefined until the user chooses: shown on larger screens, closed on phones.
  const [listChoice, setListChoice] = useState<boolean>();
  const listOpen = listChoice ?? !phone;

  const openAlertIds = useMemo(
    () =>
      new Set(
        (alerts ?? []).filter((alert) => alert.status === 'open').map((alert) => alert.deviceId),
      ),
    [alerts],
  );
  const counts = useMemo(() => overviewCounts(devices, openAlertIds), [devices, openAlertIds]);
  const shown = useMemo(
    () => overviewVehicles(devices, filter, query, openAlertIds),
    [devices, filter, query, openAlertIds],
  );
  const selected = devices.find((device) => device.deviceId === selectedId);

  const select = (deviceId: string) => {
    setSelectedId(deviceId);
    if (phone) setListChoice(false);
  };

  const list = (
    <List disablePadding sx={{ overflowY: 'auto', flex: 1 }}>
      {!shown.length && (
        <Typography color="text.secondary" sx={{ p: 3, fontSize: 13, textAlign: 'center' }}>
          No vehicles match.
        </Typography>
      )}
      {shown.map((device) => (
        <VehicleRow
          key={device.deviceId}
          alert={openAlertIds.has(device.deviceId)}
          device={device}
          selected={device.deviceId === selectedId}
          onClick={() => select(device.deviceId)}
        />
      ))}
    </List>
  );

  return (
    <Box
      sx={{
        position: 'relative',
        height: { xs: 'calc(100dvh - 120px)', md: 'calc(100dvh - 128px)' },
        minHeight: 460,
        borderRadius: '16px',
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider',
        bgcolor: '#EEF2F6',
      }}
    >
      <FleetMap devices={shown} height="100%" selectedId={selectedId} onSelect={select} />

      {/* Left column: search, filters and (on larger screens) the list. */}
      <Stack
        spacing={1}
        sx={{
          position: 'absolute',
          top: 12,
          left: 12,
          // Leaves room for the map's own controls on the right.
          right: { xs: 56, md: 'auto' },
          width: { md: 340 },
          maxHeight: 'calc(100% - 24px)',
          zIndex: 3,
          pointerEvents: 'none',
          '& > *': { pointerEvents: 'auto' },
        }}
      >
        <Stack direction="row" spacing={1} sx={{ ...floating, alignItems: 'center', px: 1.5 }}>
          <Search size={17} color="#667085" />
          <InputBase
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or GPS number"
            value={query}
            sx={{ flex: 1, fontSize: 14, py: 1 }}
            inputProps={{ 'aria-label': 'Search vehicles' }}
          />
          {query && (
            <IconButton aria-label="Clear search" onClick={() => setQuery('')} size="small">
              <X size={16} />
            </IconButton>
          )}
        </Stack>
        <Stack direction="row" sx={{ gap: 0.75, overflowX: 'auto', pb: 0.25 }}>
          {(Object.keys(overviewFilters) as OverviewFilter[]).map((key) => {
            const active = filter === key;
            const alarming = key === 'attention' && counts.attention > 0;
            return (
              <Chip
                key={key}
                clickable
                color={active ? (alarming ? 'error' : 'primary') : 'default'}
                label={`${key === 'all' ? 'All' : overviewFilters[key]} ${counts[key]}`}
                onClick={() => setFilter(active && key !== 'all' ? 'all' : key)}
                size="small"
                sx={{
                  flexShrink: 0,
                  fontWeight: 700,
                  boxShadow: '0 2px 8px rgba(23,32,51,.12)',
                  ...(!active && {
                    bgcolor: '#FFFFFF',
                    color: alarming ? 'error.main' : 'text.primary',
                  }),
                }}
              />
            );
          })}
        </Stack>
        {!phone && (
          <Paper
            elevation={0}
            sx={{
              ...floating,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 0,
              flexShrink: 1,
            }}
          >
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.25 }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: 14 }}>
                Vehicles{' '}
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                  · {shown.length}
                </Box>
              </Typography>
              <Tooltip title={listOpen ? 'Hide list' : 'Show list'}>
                <IconButton
                  aria-label={listOpen ? 'Hide vehicle list' : 'Show vehicle list'}
                  onClick={() => setListChoice(!listOpen)}
                  size="small"
                >
                  {listOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </IconButton>
              </Tooltip>
            </Stack>
            {listOpen && (
              <Box sx={{ borderTop: 1, borderColor: 'divider', display: 'flex', minHeight: 0 }}>
                {list}
              </Box>
            )}
          </Paper>
        )}
      </Stack>

      {/* Phones: the list opens as a sheet from a button at the bottom. */}
      {phone && !selected && (
        <Button
          onClick={() => setListChoice(true)}
          startIcon={<ListIcon size={17} />}
          variant="contained"
          sx={{
            position: 'absolute',
            left: '50%',
            bottom: 16,
            transform: 'translateX(-50%)',
            zIndex: 3,
            borderRadius: '20px',
            px: 2.25,
            boxShadow: '0 6px 20px rgba(21,94,239,.35)',
          }}
        >
          Vehicles · {shown.length}
        </Button>
      )}
      {phone && (
        <Drawer
          anchor="bottom"
          open={listOpen}
          onClose={() => setListChoice(false)}
          slotProps={{
            paper: {
              sx: {
                maxHeight: '70dvh',
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                display: 'flex',
                flexDirection: 'column',
              },
            },
          }}
        >
          <Stack
            direction="row"
            sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}
          >
            <Typography sx={{ fontWeight: 700 }}>Vehicles · {shown.length}</Typography>
            <IconButton aria-label="Close list" onClick={() => setListChoice(false)} size="small">
              <X size={18} />
            </IconButton>
          </Stack>
          <Box sx={{ borderTop: 1, borderColor: 'divider', display: 'flex', minHeight: 0 }}>
            {list}
          </Box>
        </Drawer>
      )}

      {selected && (
        <Box
          sx={{
            position: 'absolute',
            zIndex: 4,
            bottom: 16,
            left: { xs: 12, md: 364 },
            right: { xs: 12, md: 'auto' },
            width: { md: 360 },
          }}
        >
          <SelectedVehicle
            alert={openAlertIds.has(selected.deviceId)}
            device={selected}
            driver={assignedDriver(selected, drivers)}
            onClose={() => setSelectedId(undefined)}
            onOpen={() => onOpenVehicle(selected.deviceId)}
          />
        </Box>
      )}
    </Box>
  );
}

/** The picked vehicle in brief, with the way to its page and to its driver. */
function SelectedVehicle({
  device,
  driver,
  alert,
  onOpen,
  onClose,
}: {
  device: Device;
  driver?: Driver;
  alert: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const now = presence(device);
  const seen = device.state?.lastSeenAt;
  const type = toVehicleType(device.vehicleType);
  return (
    <Paper elevation={0} sx={{ ...floating, p: 1.75 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
        <VehicleAvatar type={type} color="#FFFFFF" background={presenceDot[now.tone]} size={40} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap sx={{ fontWeight: 800, fontSize: 15 }}>
            {device.name}
          </Typography>
          <Typography noWrap sx={{ fontSize: 12, fontWeight: 700, color: presenceDot[now.tone] }}>
            ● {now.label}
          </Typography>
        </Box>
        {alert && <Chip color="error" label="Open alert" size="small" />}
        <IconButton aria-label="Close" onClick={onClose} size="small">
          <X size={17} />
        </IconButton>
      </Stack>
      <Typography color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
        {[
          vehicleIcons[type].label,
          vehicleStatus(device) === 'moving' && `${Math.round(device.state?.speedKmh ?? 0)} km/h`,
          seen ? `last heard ${timeAgo(seen)}` : 'no update yet',
          driver ? `Driver: ${driver.name}` : 'No driver assigned',
        ]
          .filter(Boolean)
          .join(' · ')}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
        <Button endIcon={<ChevronRight size={16} />} fullWidth onClick={onOpen} variant="contained">
          Open vehicle
        </Button>
        {driver?.phone && (
          <Button
            color="success"
            fullWidth
            href={telHref(driver.phone)}
            startIcon={<PhoneCall size={16} />}
            variant="outlined"
          >
            Call driver
          </Button>
        )}
      </Stack>
    </Paper>
  );
}
