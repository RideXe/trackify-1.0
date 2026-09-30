'use client';

import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  LinearProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Bell,
  CarFront,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  IdCard,
  LogOut,
  Map,
  Menu,
  Navigation,
  Plus,
  Radio,
  QrCode,
  Route,
  Search,
  Share2,
  Settings,
  ShieldCheck,
  Smartphone,
  Truck,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import {
  CognitoPasswordClient,
  TrackifyClient,
  toVehicleType,
  type Device,
  type DeviceState,
  type Driver,
  type FleetAlert,
  type Tokens,
  type VehicleType,
} from '@trackify/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { FleetMap as FleetMapView } from './fleet-map';
import {
  statusColors,
  statusCounts,
  statusLabels,
  vehicleStatus,
  type VehicleStatus,
} from './fleet-map-data';
import { AlertsPage, SosBanner } from './alerts';
import { dutyLabel, notReporting } from './driver-activity-data';
import { DriversPage } from './drivers';
import { LiveMap } from './live-map';
import { SettingsPage } from './settings';
import { TripsPage } from './trips';
import { VehicleNotFound, VehiclePage } from './vehicle-page';
import { VehicleAvatar, VehicleTypePicker, vehicleIcons } from './vehicle-icons';
import { useView, type NamedPage, type View } from './view-state';

const drawerWidth = 256;
const config = {
  apiUrl:
    process.env.NEXT_PUBLIC_API_URL ?? 'https://f128plufw8.execute-api.ap-south-1.amazonaws.com',
  awsRegion: process.env.NEXT_PUBLIC_AWS_REGION ?? 'ap-south-1',
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '2h5u12cj2ro3p8n37fmmhfjcpq',
  realtimeDns:
    process.env.NEXT_PUBLIC_REALTIME_DNS ??
    'qax2znhhijftphzcymk3fvufqa.appsync-realtime-api.ap-south-1.amazonaws.com',
};
const auth = new CognitoPasswordClient(config);
/** Fired when a renewal replaces or ends the stored session, so the page can follow it. */
const sessionEvent = 'trackify:session';

interface PasswordChallenge {
  username: string;
  session: string;
}

interface Membership {
  tenantId: string;
  userId: string;
  role: string;
  email?: string;
}

interface DeviceInvitation {
  invitationId: string;
  code: string;
  link: string;
  status: 'waiting' | 'activated' | 'expired' | 'revoked';
  createdAt: number;
  expiresAt: number;
}

type CreatedDevice = Device & { onboarding?: DeviceInvitation };

/** An entry without a page is not built yet; it shows as disabled with a "Soon" tag. */
const navItems: Array<{ label: string; icon: typeof Gauge; page?: NamedPage }> = [
  { label: 'Overview', icon: Gauge, page: 'overview' },
  { label: 'Live map', icon: Map, page: 'live-map' },
  { label: 'Trips', icon: Route, page: 'trips' },
  { label: 'Drivers', icon: IdCard, page: 'drivers' },
  { label: 'Alerts', icon: Bell, page: 'alerts' },
  { label: 'Team', icon: Users },
];

export default function FleetPage() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [tokens, setTokens] = useState<Tokens>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>();
  const [driversError, setDriversError] = useState('');
  const [view, navigate] = useView();
  const [alerts, setAlerts] = useState<FleetAlert[]>();
  const [alertsError, setAlertsError] = useState('');
  const [membership, setMembership] = useState<Membership>();
  const [challenge, setChallenge] = useState<PasswordChallenge>();
  const [error, setError] = useState('');
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const client = useMemo(
    () => new TrackifyClient(config, () => readTokens()?.access_token, renewStoredSession),
    [tokens],
  );

  useEffect(() => {
    const follow = () => {
      const current = readTokens();
      setTokens(current);
      if (!current) setError('Your session expired. Please sign in again.');
    };
    window.addEventListener(sessionEvent, follow);
    return () => window.removeEventListener(sessionEvent, follow);
  }, []);

  const loadFleet = useCallback(async () => {
    try {
      const result = await client.devices();
      setDevices(result.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Fleet unavailable');
    } finally {
      setLoadingFleet(false);
    }
  }, [client]);

  const loadDrivers = useCallback(async () => {
    setDriversError('');
    try {
      setDrivers((await client.drivers()).items);
    } catch (reason) {
      setDriversError(reason instanceof Error ? reason.message : 'Drivers unavailable');
    }
  }, [client]);

  useEffect(() => {
    if (tokens) void loadDrivers();
  }, [tokens, loadDrivers]);

  const loadAlerts = useCallback(async () => {
    try {
      setAlerts((await client.alerts()).items);
      setAlertsError('');
    } catch (reason) {
      setAlertsError(reason instanceof Error ? reason.message : 'Alerts unavailable');
    }
  }, [client]);

  // An SOS must surface quickly, so alerts refresh more often than the fleet list.
  useEffect(() => {
    if (!tokens) return;
    void loadAlerts();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadAlerts();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [tokens, loadAlerts]);

  useEffect(() => {
    const saved = readTokens();
    if (saved) setTokens(saved);
    else setLoadingFleet(false);
  }, []);

  useEffect(() => {
    if (!tokens) return;
    void loadFleet();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadFleet();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [tokens, loadFleet]);

  useEffect(() => {
    if (!tokens) return;
    let close: () => void = () => undefined;
    void client
      .me()
      .then((nextMembership) => {
        setMembership(nextMembership);
        close = client.subscribeFleet(nextMembership.tenantId, (update) => {
          // A live update is one position: keep the rest of the state (odometer, trip, ...) and
          // mark the vehicle as just seen, so it does not look quiet until the next refresh.
          const withUpdate = (device: Device): Device => ({
            ...device,
            state: {
              ...device.state,
              ...update,
              lastSeenAt: Date.now(),
              status: 'online',
              motion: (update.speedKmh ?? 0) > 0,
            } satisfies DeviceState,
          });
          setDevices((current) =>
            current.map((device) =>
              device.deviceId === update.deviceId ? withUpdate(device) : device,
            ),
          );
        });
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : 'Account unavailable'),
      );
    return () => close();
  }, [client, tokens]);

  async function signIn(username: string, password: string) {
    setError('');
    try {
      const result = await auth.signIn(username.trim(), password);
      if (result.status === 'new-password-required') {
        setChallenge(result);
        return;
      }
      saveTokens(result.tokens);
      setLoadingFleet(true);
      setTokens(result.tokens);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign-in failed');
    }
  }

  async function setNewPassword(password: string) {
    if (!challenge) return;
    setError('');
    try {
      const next = await auth.setNewPassword(challenge.username, password, challenge.session);
      saveTokens(next);
      setLoadingFleet(true);
      setTokens(next);
      setChallenge(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Password update failed');
    }
  }

  if (!tokens) {
    return (
      <Login
        challenge={challenge}
        error={error}
        onSignIn={signIn}
        onSetNewPassword={setNewPassword}
      />
    );
  }

  const online = devices.filter((device) => isOnline(device)).length;
  const admin = membership?.role === 'admin';
  const viewed =
    view.page === 'vehicle'
      ? devices.find((device) => device.deviceId === view.deviceId)
      : undefined;
  const openAlerts = (alerts ?? []).filter((alert) => alert.status === 'open').length;
  const [title, subtitle] =
    view.page === 'drivers'
      ? ['Drivers', 'People who drive your vehicles']
      : view.page === 'live-map'
        ? ['Live map', 'Where every vehicle is right now']
        : view.page === 'trips'
          ? ['Trips', 'Completed journeys across the fleet']
          : view.page === 'alerts'
            ? ['Alerts', 'SOS, driver reports and phone problems']
            : view.page === 'settings'
              ? ['Settings', 'What drivers see in their app']
              : view.page === 'vehicle'
                ? [viewed?.name ?? 'Vehicle', 'Live status, driver and route history']
                : ['Fleet overview', 'Live operations and vehicle health'];
  const go = (next: View) => {
    setMobileNav(false);
    navigate(next);
  };
  const onboardingVisible =
    onboardingOpen ||
    (!loadingFleet && membership?.role === 'admin' && devices.length === 0 && !onboardingDismissed);

  const drawer = (
    <NavigationDrawer
      email={membership?.email}
      page={view.page === 'vehicle' ? 'overview' : view.page}
      openAlerts={openAlerts}
      onNavigate={(page) => go({ page })}
      onAdd={() => {
        setOnboardingOpen(true);
        setMobileNav(false);
      }}
      onSignOut={signOut}
    />
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar
        color="inherit"
        elevation={0}
        position="fixed"
        sx={{
          ml: { md: `${drawerWidth}px` },
          width: { md: `calc(100% - ${drawerWidth}px)` },
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 64, md: 72 }, gap: 1.5 }}>
          {!desktop && (
            <IconButton aria-label="Open navigation" onClick={() => setMobileNav(true)}>
              <Menu size={21} />
            </IconButton>
          )}
          <Box sx={{ flex: 1 }}>
            <Typography noWrap variant="h6" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            <Typography color="text.secondary" variant="caption">
              {subtitle}
            </Typography>
          </Box>
          <Chip
            icon={<CircleDot size={14} />}
            color={online ? 'success' : 'default'}
            label={`${online} online`}
            size="small"
            variant="outlined"
          />
          {membership?.role === 'admin' && (
            <Button
              onClick={() => setOnboardingOpen(true)}
              startIcon={<Plus size={18} />}
              variant="contained"
            >
              Add vehicle
            </Button>
          )}
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}>
        <Drawer
          open={mobileNav}
          onClose={() => setMobileNav(false)}
          variant="temporary"
          slotProps={{ paper: { sx: { width: drawerWidth } } }}
          sx={{ display: { xs: 'block', md: 'none' } }}
        >
          {drawer}
        </Drawer>
        <Drawer
          open
          variant="permanent"
          slotProps={{ paper: { sx: { width: drawerWidth, borderRightColor: 'divider' } } }}
          sx={{ display: { xs: 'none', md: 'block' } }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          pt: { xs: '88px', md: '96px' },
          px: { xs: 2, sm: 3, lg: 4 },
          pb: 4,
        }}
      >
        <SosBanner
          alerts={alerts ?? []}
          onOpenAlerts={() => go({ page: 'alerts' })}
          onOpenVehicle={(deviceId) => go({ page: 'vehicle', deviceId })}
        />
        {loadingFleet ? (
          <Stack
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
          >
            <CircularProgress size={32} />
            <Typography color="text.secondary">Loading your fleet…</Typography>
          </Stack>
        ) : view.page === 'live-map' ? (
          <LiveMap
            devices={devices}
            onOpenVehicle={(deviceId) => go({ page: 'vehicle', deviceId })}
          />
        ) : view.page === 'trips' ? (
          <TripsPage
            client={client}
            devices={devices}
            onOpenVehicle={(deviceId) => go({ page: 'vehicle', deviceId })}
          />
        ) : view.page === 'alerts' ? (
          <AlertsPage
            alerts={alerts}
            canAcknowledge={membership?.role !== 'viewer'}
            client={client}
            error={alertsError}
            onChanged={loadAlerts}
            onOpenVehicle={(deviceId) => go({ page: 'vehicle', deviceId })}
          />
        ) : view.page === 'settings' ? (
          <SettingsPage admin={admin} client={client} />
        ) : view.page === 'drivers' ? (
          <DriversPage
            admin={admin}
            client={client}
            devices={devices}
            drivers={drivers}
            error={driversError}
            onChanged={async () => {
              // Removing a driver also unassigns them from vehicles, so both lists can change.
              await Promise.all([loadDrivers(), loadFleet()]);
            }}
            onOpenVehicle={(deviceId) => go({ page: 'vehicle', deviceId })}
            onRetry={() => void loadDrivers()}
          />
        ) : view.page === 'vehicle' ? (
          viewed ? (
            <VehiclePage
              key={viewed.deviceId}
              admin={admin}
              client={client}
              canDispatch={membership?.role !== 'viewer'}
              connection={<TrackerConnection admin={admin} device={viewed} />}
              device={viewed}
              devices={devices}
              drivers={drivers}
              driversError={driversError}
              onBack={() => go({ page: 'overview' })}
              onChanged={loadFleet}
              onDriversChanged={loadDrivers}
              onRemoved={async () => {
                go({ page: 'overview' });
                await loadFleet();
              }}
            />
          ) : (
            <VehicleNotFound onBack={() => go({ page: 'overview' })} />
          )
        ) : (
          <Dashboard
            devices={devices}
            admin={admin}
            online={online}
            openAlerts={openAlerts}
            onAdd={() => setOnboardingOpen(true)}
            onOpen={(deviceId) => go({ page: 'vehicle', deviceId })}
          />
        )}
      </Box>

      <DeviceOnboarding
        client={client}
        firstVehicle={!devices.length}
        open={onboardingVisible}
        onClose={() => {
          setOnboardingOpen(false);
          setOnboardingDismissed(true);
        }}
        onCreated={loadFleet}
        onConnected={(deviceId) => go({ page: 'vehicle', deviceId })}
      />
      {error && (
        <Alert
          severity="error"
          onClose={() => setError('')}
          sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 30, boxShadow: 4 }}
        >
          {error}
        </Alert>
      )}
    </Box>
  );
}

function NavigationDrawer({
  email,
  page,
  openAlerts,
  onNavigate,
  onAdd,
  onSignOut,
}: {
  email?: string;
  page: NamedPage;
  openAlerts: number;
  onNavigate: (page: NamedPage) => void;
  onAdd: () => void;
  onSignOut: () => void;
}) {
  return (
    <Stack sx={{ height: '100%', bgcolor: '#FFFFFF' }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', px: 2.5, minHeight: 72 }}>
        <Avatar variant="rounded" sx={{ bgcolor: 'primary.main', width: 38, height: 38 }}>
          <Navigation size={21} />
        </Avatar>
        <Box>
          <Typography sx={{ fontWeight: 750, lineHeight: 1.1 }}>Trackify</Typography>
          <Typography color="text.secondary" variant="caption">
            Fleet operations
          </Typography>
        </Box>
      </Stack>
      <Divider />
      <Box sx={{ px: 1.5, py: 2 }}>
        <Button fullWidth onClick={onAdd} startIcon={<Plus size={18} />} variant="contained">
          Add vehicle
        </Button>
      </Box>
      <List sx={{ px: 1.5, py: 0 }}>
        {navItems.map(({ label, icon: Icon, page: target }) => {
          const active = target === page;
          return (
            <ListItemButton
              key={label}
              disabled={!target}
              onClick={target ? () => onNavigate(target) : undefined}
              selected={active}
              sx={{ mb: 0.5, borderRadius: 2, color: active ? 'primary.main' : 'text.secondary' }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: 'inherit' }}>
                <Icon size={19} />
              </ListItemIcon>
              <ListItemText
                primary={label}
                slotProps={{ primary: { sx: { fontWeight: active ? 700 : 550 } } }}
              />
              {target === 'alerts' && openAlerts > 0 && (
                <Chip color="error" label={openAlerts} size="small" />
              )}
              {!target && <Chip label="Soon" size="small" variant="outlined" />}
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ flex: 1 }} />
      <List sx={{ px: 1.5 }}>
        <ListItemButton
          onClick={() => onNavigate('settings')}
          selected={page === 'settings'}
          sx={{ borderRadius: 2 }}
        >
          <ListItemIcon sx={{ minWidth: 38 }}>
            <Settings size={19} />
          </ListItemIcon>
          <ListItemText primary="Settings" />
        </ListItemButton>
      </List>
      <Divider />
      <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', p: 2 }}>
        <Avatar sx={{ width: 36, height: 36, bgcolor: '#EEF4FF', color: 'primary.main' }}>
          {(email ?? 'A').slice(0, 1).toUpperCase()}
        </Avatar>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography noWrap variant="body2" sx={{ fontWeight: 650 }}>
            Fleet administrator
          </Typography>
          <Typography color="text.secondary" noWrap variant="caption">
            {email ?? 'Signed in'}
          </Typography>
        </Box>
        <Tooltip title="Sign out">
          <IconButton aria-label="Sign out" onClick={onSignOut} size="small">
            <LogOut size={18} />
          </IconButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

function Dashboard({
  devices,
  admin,
  online,
  openAlerts,
  onAdd,
  onOpen,
}: {
  devices: Device[];
  admin: boolean;
  online: number;
  openAlerts: number;
  onAdd: () => void;
  onOpen: (deviceId: string) => void;
}) {
  if (!devices.length) {
    return <EmptyFleet admin={admin} onAdd={onAdd} />;
  }
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4">Good to see you</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          Here is what is happening across your fleet right now.
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', xl: 'repeat(4, 1fr)' },
          gap: 2,
        }}
      >
        <MetricCard icon={Truck} label="Total vehicles" value={devices.length} tone="#155EEF" />
        <MetricCard icon={Wifi} label="Online now" value={online} tone="#079455" />
        <MetricCard
          icon={Clock3}
          label="Currently quiet"
          value={devices.length - online}
          tone="#DC6803"
        />
        <MetricCard icon={Bell} label="Open alerts" value={openAlerts} tone="#D92D20" />
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 360px' },
          gap: 3,
        }}
      >
        <FleetMap devices={devices} onOpen={onOpen} />
        <VehicleList devices={devices} onOpen={onOpen} />
      </Box>
    </Stack>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Truck;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography color="text.secondary" variant="body2">
              {label}
            </Typography>
            <Typography variant="h4" sx={{ mt: 1 }}>
              {value}
            </Typography>
          </Box>
          <Avatar variant="rounded" sx={{ bgcolor: `${tone}12`, color: tone }}>
            <Icon size={21} />
          </Avatar>
        </Stack>
      </CardContent>
    </Card>
  );
}

function EmptyFleet({ admin, onAdd }: { admin: boolean; onAdd: () => void }) {
  return (
    <Paper sx={{ minHeight: 'calc(100vh - 140px)', display: 'grid', placeItems: 'center', p: 3 }}>
      <Stack spacing={2.25} sx={{ alignItems: 'center', maxWidth: 520, textAlign: 'center' }}>
        <Avatar sx={{ width: 72, height: 72, bgcolor: '#EEF4FF', color: 'primary.main' }}>
          <CarFront size={34} />
        </Avatar>
        <Box>
          <Typography variant="h4">Build your live fleet</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>
            {admin
              ? 'Add your first vehicle, connect its GPS identifier, and Trackify will bring every location update into one operational view.'
              : 'Your workspace is ready. Ask a fleet administrator to add the first vehicle.'}
          </Typography>
        </Box>
        {admin && (
          <Button onClick={onAdd} size="large" startIcon={<Plus size={19} />} variant="contained">
            Add your first vehicle
          </Button>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 2, width: '100%' }}>
          {[
            [ShieldCheck, 'Secure tenant setup'],
            [Radio, 'Realtime GPS updates'],
            [Bell, 'Fleet event alerts'],
          ].map(([Icon, label]) => {
            const FeatureIcon = Icon as typeof ShieldCheck;
            return (
              <Stack key={String(label)} spacing={0.75} sx={{ alignItems: 'center', flex: 1 }}>
                <FeatureIcon color="#667085" size={19} />
                <Typography color="text.secondary" variant="caption">
                  {String(label)}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      </Stack>
    </Paper>
  );
}

function FleetMap({ devices, onOpen }: { devices: Device[]; onOpen: (deviceId: string) => void }) {
  const counts = statusCounts(devices);
  const onMap = devices.filter(hasPosition).length;
  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between', p: 2 }}
      >
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Fleet map</Typography>
          <Typography color="text.secondary" variant="caption">
            {onMap
              ? `${onMap} of ${devices.length} vehicles on the map · point at a vehicle for details, click to open it`
              : 'Waiting for the first GPS signal'}
          </Typography>
        </Box>
        <Stack direction="row" sx={{ flexWrap: 'wrap', columnGap: 2, rowGap: 0.5 }}>
          {(Object.keys(counts) as VehicleStatus[]).map((status) => (
            <Stack key={status} direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <Box
                sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: statusColors[status] }}
              />
              <Typography variant="caption">
                {statusLabels[status]} {counts[status]}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Stack>
      <FleetMapView devices={devices} onSelect={onOpen} />
    </Paper>
  );
}

function hasPosition(device: Device) {
  return Number.isFinite(device.state?.latitude) && Number.isFinite(device.state?.longitude);
}
function isOnline(device: Device) {
  const seen = device.state?.lastSeenAt;
  return Boolean(seen && Date.now() - seen < 300_000 && device.state?.status !== 'offline');
}

function VehicleList({
  devices,
  onOpen,
}: {
  devices: Device[];
  onOpen: (deviceId: string) => void;
}) {
  return (
    <Paper sx={{ overflow: 'hidden', minHeight: 400 }}>
      <Stack spacing={2} sx={{ px: 2.5, py: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Vehicles</Typography>
          <Typography color="text.secondary" variant="caption">
            Open a vehicle for its live status, driver and history
          </Typography>
        </Box>
        <TextField
          placeholder="Search vehicles"
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
      </Stack>
      <Divider />
      <List disablePadding>
        {devices.map((device) => {
          const online = isOnline(device);
          return (
            <ListItemButton
              key={device.deviceId}
              onClick={() => onOpen(device.deviceId)}
              sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider' }}
            >
              <Box sx={{ mr: 1.5 }}>
                <VehicleAvatar
                  type={toVehicleType(device.vehicleType)}
                  color={statusColors[vehicleStatus(device)]}
                  background="#F2F4F7"
                />
              </Box>
              <ListItemText
                primary={device.name}
                secondary={[
                  vehicleIcons[toVehicleType(device.vehicleType)].label,
                  statusLabels[vehicleStatus(device)],
                  vehicleStatus(device) === 'moving' &&
                    `${Math.round(device.state?.speedKmh ?? 0)} km/h`,
                  notReporting(device) ? 'On shift · not reporting' : dutyLabel(device),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                slotProps={{ primary: { sx: { fontWeight: 650 } } }}
              />
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: online ? 'success.main' : '#D0D5DD',
                  mr: 1,
                }}
              />
              <ChevronRight size={17} color="#98A2B3" />
            </ListItemButton>
          );
        })}
      </List>
    </Paper>
  );
}

/** Whether the vehicle's tracker (usually the driver's phone) is connected, and pairing it. */
function TrackerConnection({ device, admin }: { device: Device; admin: boolean }) {
  const [pairing, setPairing] = useState<DeviceInvitation>();
  const [pairingQr, setPairingQr] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<DeviceInvitation['status']>();
  const [justConnected, setJustConnected] = useState(false);
  // While the setup code is on screen, watch for the phone to redeem it and then close the code.
  useEffect(() => {
    if (!pairing) return;
    let active = true;
    const timer = window.setInterval(() => {
      void apiFetch(`/devices/${encodeURIComponent(device.deviceId)}/invitations`)
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value: { items?: DeviceInvitation[] } | undefined) => {
          const current = value?.items?.find((item) => item.invitationId === pairing.invitationId);
          if (!active || current?.status !== 'activated') return;
          setPairing(undefined);
          setConnectionStatus('activated');
          setJustConnected(true);
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [pairing, device.deviceId]);
  useEffect(() => {
    let active = true;
    setConnectionStatus(undefined);
    setPairing(undefined);
    setPairingError('');
    const refresh = async () => {
      const response = await apiFetch(
        `/devices/${encodeURIComponent(device.deviceId)}/invitations`,
      );
      if (!response.ok || !active) return;
      const value = (await response.json()) as { items?: DeviceInvitation[] };
      const latest = value.items?.find((item) => item.status === 'activated') ?? value.items?.[0];
      if (active) {
        setConnectionStatus(latest?.status);
        setPairingError('');
      }
    };
    const check = () =>
      void refresh().catch(() => {
        if (active) setPairingError('Connection status unavailable. Retrying…');
      });
    check();
    const timer = window.setInterval(() => {
      if (!document.hidden) check();
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [device.deviceId]);
  async function createPairing() {
    setPairingBusy(true);
    setPairingError('');
    try {
      const existingResponse = await apiFetch(
        `/devices/${encodeURIComponent(device.deviceId)}/invitations`,
      );
      if (!existingResponse.ok) throw new Error('Could not check the existing connection');
      const existing = (await existingResponse.json()) as { items: DeviceInvitation[] };
      if (
        existing.items.some((item) => item.status === 'activated') &&
        !window.confirm('Replace the connected phone? The previous phone will lose access.')
      )
        return;
      for (const item of existing.items.filter(
        (item) => item.status === 'waiting' || item.status === 'activated',
      )) {
        const revoked = await apiFetch(`/invitations/${item.invitationId}`, {
          method: 'DELETE',
        });
        if (!revoked.ok && revoked.status !== 404)
          throw new Error('Could not revoke the previous connection');
      }
      const response = await apiFetch(
        `/devices/${encodeURIComponent(device.deviceId)}/invitations`,
        { method: 'POST' },
      );
      const invitation = (await response.json()) as DeviceInvitation & { message?: string };
      if (!response.ok) throw new Error(invitation.message || 'Could not create setup code');
      setPairing(invitation);
      setConnectionStatus(invitation.status);
      setPairingQr(await QRCode.toDataURL(invitation.link, { width: 240, margin: 1 }));
    } catch (reason) {
      setPairingError(reason instanceof Error ? reason.message : 'Could not create setup code');
    } finally {
      setPairingBusy(false);
    }
  }
  /** Revokes the phone's credential; the app notices on its next check-in and signs itself out. */
  async function disconnectPhone() {
    if (
      !window.confirm(
        `Disconnect the phone from ${device.name}? It stops sharing location at once and needs a new setup code to reconnect.`,
      )
    )
      return;
    setPairingBusy(true);
    setPairingError('');
    try {
      const response = await apiFetch(
        `/devices/${encodeURIComponent(device.deviceId)}/invitations`,
      );
      if (!response.ok) throw new Error('Could not check the existing connection');
      const { items } = (await response.json()) as { items: DeviceInvitation[] };
      for (const item of items.filter((item) => item.status === 'activated')) {
        const revoked = await apiFetch(`/invitations/${item.invitationId}`, { method: 'DELETE' });
        if (!revoked.ok && revoked.status !== 404)
          throw new Error('Could not disconnect the phone');
      }
      setConnectionStatus('revoked');
    } catch (reason) {
      setPairingError(reason instanceof Error ? reason.message : 'Could not disconnect the phone');
    } finally {
      setPairingBusy(false);
    }
  }
  return (
    <Paper sx={{ p: 2.5 }}>
      <Typography sx={{ fontWeight: 700 }}>Tracker</Typography>
      <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
        {device.protocol === 'osmand'
          ? "The Trackify app on the driver's phone reports this vehicle's position."
          : `A ${device.protocol.toUpperCase()} GPS unit reports this vehicle's position.`}
      </Typography>
      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        {isOnline(device) ? (
          <Chip color="success" icon={<CheckCircle2 size={15} />} label="Tracking online" />
        ) : connectionStatus === 'activated' ? (
          <Chip
            color={device.dutyStatus === 'on' ? 'warning' : 'default'}
            icon={<Clock3 size={15} />}
            label={
              device.dutyStatus === 'on'
                ? hasPosition(device)
                  ? 'On shift · last known location'
                  : 'On shift · waiting for GPS'
                : device.dutyStatus === 'paused'
                  ? 'Phone connected · driver on a pause'
                  : "Phone connected · driver hasn't started a shift"
            }
          />
        ) : (
          <Button
            disabled={pairingBusy}
            onClick={() => void createPairing()}
            startIcon={<Smartphone size={17} />}
            variant="outlined"
          >
            {pairingBusy
              ? 'Creating…'
              : connectionStatus === 'waiting'
                ? 'Generate replacement code'
                : 'Connect driver phone'}
          </Button>
        )}
        {connectionStatus === 'activated' && (
          <Stack direction="row" spacing={1}>
            <Button disabled={pairingBusy} size="small" onClick={() => void createPairing()}>
              Replace connected phone
            </Button>
            {admin && (
              <Button
                color="error"
                disabled={pairingBusy}
                size="small"
                onClick={() => void disconnectPhone()}
              >
                Disconnect phone
              </Button>
            )}
          </Stack>
        )}
      </Stack>
      {justConnected && (
        <Alert severity="success" sx={{ mt: 2 }} onClose={() => setJustConnected(false)}>
          Phone connected ✓. Location appears once the driver taps Start shift.
        </Alert>
      )}
      {pairingError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {pairingError}
        </Alert>
      )}
      <Dialog open={Boolean(pairing)} onClose={() => setPairing(undefined)} fullWidth maxWidth="xs">
        <DialogTitle component="div">
          <Typography component="h2" variant="h5">
            Connect {device.name}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Share this one-time code with the driver.
          </Typography>
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: 1 }}>
            {pairingQr && (
              <Box
                component="img"
                src={pairingQr}
                alt={`Setup QR for ${device.name}`}
                sx={{ width: 210, height: 210 }}
              />
            )}
            <Typography component="div" sx={{ fontSize: 32, fontWeight: 900, letterSpacing: 6 }}>
              {pairing?.code}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Single use · expires in 24 hours · no driver login required
            </Typography>
            <Stack direction="row" spacing={1} sx={{ width: '100%' }}>
              <Button
                fullWidth
                variant="outlined"
                startIcon={<Copy size={17} />}
                onClick={() => void navigator.clipboard.writeText(pairing!.link)}
              >
                Copy
              </Button>
              <Button
                fullWidth
                variant="contained"
                startIcon={<Share2 size={17} />}
                onClick={() =>
                  void (navigator.share
                    ? navigator.share({
                        title: `Connect ${device.name}`,
                        text: `Use Trackify setup code ${pairing!.code}.`,
                        url: pairing!.link,
                      })
                    : navigator.clipboard.writeText(pairing!.link))
                }
              >
                Share
              </Button>
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPairing(undefined)}>Done</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function Login({
  challenge,
  error,
  onSignIn,
  onSetNewPassword,
}: {
  challenge?: PasswordChallenge;
  error: string;
  onSignIn: (username: string, password: string) => Promise<void>;
  onSetNewPassword: (password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (challenge) await onSetNewPassword(password);
      else await onSignIn(username, password);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: '1.1fr 0.9fr' },
      }}
    >
      <Box
        sx={{
          display: { xs: 'none', lg: 'flex' },
          position: 'relative',
          overflow: 'hidden',
          flexDirection: 'column',
          justifyContent: 'space-between',
          p: 7,
          color: 'white',
          bgcolor: '#0B1F3A',
          backgroundImage:
            'radial-gradient(circle at 80% 20%, #155EEF 0, transparent 38%), radial-gradient(circle at 20% 90%, #0E9384 0, transparent 32%)',
        }}
      >
        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
          <Avatar variant="rounded" sx={{ bgcolor: 'white', color: 'primary.main' }}>
            <Navigation size={22} />
          </Avatar>
          <Typography sx={{ fontWeight: 750, fontSize: 20 }}>Trackify</Typography>
        </Stack>
        <Box sx={{ maxWidth: 650 }}>
          <Chip
            label="Realtime fleet operations"
            sx={{ mb: 3, bgcolor: '#FFFFFF18', color: 'white' }}
          />
          <Typography
            variant="h1"
            sx={{ fontSize: 'clamp(3.5rem, 6vw, 6.3rem)', lineHeight: 0.95 }}
          >
            Every vehicle. One clear view.
          </Typography>
          <Typography
            sx={{ mt: 3, maxWidth: 520, color: '#D0D5DD', fontSize: 18, lineHeight: 1.7 }}
          >
            Monitor locations, trips, and fleet events from a secure operations workspace built to
            scale.
          </Typography>
        </Box>
        <Stack direction="row" spacing={3} color="#D0D5DD">
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ShieldCheck size={18} />
            <Typography variant="body2">Secure by default</Typography>
          </Stack>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Radio size={18} />
            <Typography variant="body2">Live updates</Typography>
          </Stack>
        </Stack>
      </Box>
      <Box sx={{ display: 'grid', placeItems: 'center', p: { xs: 2.5, sm: 5 } }}>
        <Box
          component="form"
          onSubmit={(event) => void submit(event)}
          sx={{ width: '100%', maxWidth: 430 }}
        >
          <Stack
            direction="row"
            spacing={1.25}
            sx={{ alignItems: 'center', mb: 5, display: { lg: 'none' } }}
          >
            <Avatar variant="rounded" sx={{ bgcolor: 'primary.main' }}>
              <Navigation size={21} />
            </Avatar>
            <Typography sx={{ fontWeight: 750, fontSize: 20 }}>Trackify</Typography>
          </Stack>
          <Typography color="primary.main" variant="overline" sx={{ fontWeight: 700 }}>
            Trackify access
          </Typography>
          <Typography variant="h3" sx={{ mt: 0.5 }}>
            {challenge ? 'Choose a new password' : 'Welcome back'}
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 1, mb: 4, lineHeight: 1.6 }}>
            {challenge
              ? 'Your temporary password worked. Create the password you will use from now on.'
              : 'Sign in with the account provided by your fleet administrator.'}
          </Typography>
          <Stack spacing={2.25}>
            {!challenge && (
              <TextField
                autoComplete="username"
                autoFocus
                fullWidth
                label="Email or username"
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
            )}
            <TextField
              autoComplete={challenge ? 'new-password' : 'current-password'}
              fullWidth
              label={challenge ? 'New password' : 'Password'}
              onChange={(event) => setPassword(event.target.value)}
              required
              type={visible ? 'text' : 'password'}
              value={password}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={visible ? 'Hide password' : 'Show password'}
                        edge="end"
                        onClick={() => setVisible((current) => !current)}
                      >
                        {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            {challenge && (
              <Alert severity="info">
                Use at least 12 characters with uppercase, lowercase, and a number.
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}
            <Button disabled={busy} fullWidth size="large" type="submit" variant="contained">
              {busy ? 'Please wait…' : challenge ? 'Set password and continue' : 'Sign in'}
            </Button>
          </Stack>
          <Typography
            color="text.secondary"
            variant="caption"
            sx={{ display: 'block', mt: 4, textAlign: 'center' }}
          >
            Protected by Amazon Cognito · Trackify never stores your password
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function DeviceOnboarding({
  client,
  firstVehicle,
  open,
  onClose,
  onCreated,
  onConnected,
}: {
  client: TrackifyClient;
  firstVehicle: boolean;
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  /** The driver's phone redeemed the setup code; the dialog has closed itself. */
  onConnected: (deviceId: string) => void;
}) {
  const [name, setName] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [created, setCreated] = useState<CreatedDevice>();
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [invitationStatus, setInvitationStatus] = useState<DeviceInvitation['status']>('waiting');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const close = () => {
    onClose();
    setTimeout(() => {
      setCreated(undefined);
      setName('');
      setVehicleType('car');
      setQrDataUrl('');
      setInvitationStatus('waiting');
      setError('');
    }, 250);
  };
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const device = (await client.createDevice({
        name: name.trim(),
        uniqueId: `phone-${crypto.randomUUID()}`,
        protocol: 'osmand',
        retentionDays: 90,
        groupId: 'UNGROUPED',
        vehicleType,
      })) as CreatedDevice;
      setCreated(device);
      if (device.onboarding?.link) {
        setInvitationStatus(device.onboarding.status);
        setQrDataUrl(await QRCode.toDataURL(device.onboarding.link, { width: 240, margin: 1 }));
      }
      await onCreated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Vehicle could not be added');
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!created?.onboarding || invitationStatus !== 'waiting') return;
    const timer = window.setInterval(() => {
      void apiFetch(`/devices/${encodeURIComponent(created.deviceId)}/invitations`)
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value: { items?: DeviceInvitation[] } | undefined) => {
          const current = value?.items?.find(
            (item) => item.invitationId === created.onboarding?.invitationId,
          );
          if (current) setInvitationStatus(current.status);
        })
        .catch(() => setError('Unable to refresh pairing status. Please retry.'));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [created, invitationStatus]);

  // Once the phone is connected there is nothing left to do here: show it briefly, then go to
  // the vehicle so the admin sees it come online.
  useEffect(() => {
    if (!created || invitationStatus !== 'activated' || !open) return;
    const timer = window.setTimeout(() => {
      close();
      onConnected(created.deviceId);
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [created, invitationStatus, open]);

  async function revokeInvitation() {
    if (!created?.onboarding) return;
    const result = await apiFetch(`/invitations/${created.onboarding.invitationId}`, {
      method: 'DELETE',
    });
    if (result.ok) setInvitationStatus('revoked');
  }

  async function createReplacementInvitation() {
    if (!created) return;
    setBusy(true);
    try {
      const response = await apiFetch(
        `/devices/${encodeURIComponent(created.deviceId)}/invitations`,
        { method: 'POST' },
      );
      const invitation = (await response.json()) as DeviceInvitation & { message?: string };
      if (!response.ok) throw new Error(invitation.message || 'Could not create setup link');
      setCreated({ ...created, onboarding: invitation });
      setInvitationStatus(invitation.status);
      setQrDataUrl(await QRCode.toDataURL(invitation.link, { width: 240, margin: 1 }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not create setup link');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog fullWidth maxWidth="sm" onClose={close} open={open}>
      <DialogTitle component="div" sx={{ pr: 7 }}>
        <Typography color="primary.main" variant="overline" sx={{ fontWeight: 700 }}>
          {firstVehicle ? 'Fleet setup' : 'Vehicle setup'}
        </Typography>
        <Typography component="h2" variant="h4">
          {created
            ? 'Vehicle registered'
            : firstVehicle
              ? 'Connect your first vehicle'
              : 'Add a vehicle'}
        </Typography>
        <IconButton
          aria-label="Close"
          onClick={close}
          sx={{ position: 'absolute', top: 16, right: 16 }}
        >
          <X size={20} />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <Stepper activeStep={created ? 1 : 0} sx={{ mb: 4, mt: 1 }}>
          <Step>
            <StepLabel>Vehicle details</StepLabel>
          </Step>
          <Step>
            <StepLabel>Connect tracker</StepLabel>
          </Step>
        </Stepper>
        {!created ? (
          <Stack spacing={2.5}>
            <Typography color="text.secondary">
              Enter the vehicle name. Trackify will create a secure, one-time setup code that you
              can share with the driver. No IMEI or driver login is required.
            </Typography>
            <TextField
              autoFocus
              fullWidth
              label="Vehicle name"
              onChange={(event) => setName(event.target.value)}
              placeholder="KA 01 AB 1234 or Delivery Van 1"
              required
              value={name}
            />
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                Vehicle type
              </Typography>
              <VehicleTypePicker value={vehicleType} onChange={setVehicleType} disabled={busy} />
            </Box>
            <Alert severity="info" icon={<Smartphone />}>
              After adding the vehicle, share its QR code or six-character code with the driver. The
              Trackify app connects directly without asking for an account.
            </Alert>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        ) : (
          <Stack spacing={2.5} sx={{ alignItems: 'center', py: 2, textAlign: 'center' }}>
            <Avatar sx={{ width: 64, height: 64, bgcolor: '#ECFDF3', color: 'success.main' }}>
              <CheckCircle2 size={32} />
            </Avatar>
            <Box>
              <Typography variant="h5">{created.name} is ready</Typography>
              <Typography color="text.secondary" sx={{ mt: 1 }}>
                Its status will change to online after Trackify receives the first valid GPS update.
              </Typography>
            </Box>
            {created.protocol === 'osmand' && created.onboarding ? (
              <Paper variant="outlined" sx={{ width: '100%', p: 2.5, borderRadius: 3 }}>
                <Stack spacing={2} sx={{ alignItems: 'center' }}>
                  <QrCode size={22} />
                  <Typography sx={{ fontWeight: 800 }}>Driver setup code</Typography>
                  {qrDataUrl && (
                    <Box
                      alt={`QR code for ${created.name}`}
                      component="img"
                      src={qrDataUrl}
                      sx={{ width: 200, height: 200, borderRadius: 2 }}
                    />
                  )}
                  <Typography
                    component="div"
                    sx={{ fontSize: 32, fontWeight: 900, letterSpacing: 6 }}
                  >
                    {created.onboarding.code}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {invitationStatus === 'waiting' && 'Waiting for driver · expires in 24 hours'}
                    {invitationStatus === 'activated' &&
                      'Phone connected ✓ · opening the vehicle… The driver taps Start shift to begin sharing location.'}
                    {invitationStatus === 'expired' && 'Expired · create a new setup link'}
                    {invitationStatus === 'revoked' && 'Revoked · this link can no longer be used'}
                  </Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ width: '100%' }}>
                    <Button
                      fullWidth
                      startIcon={<Copy size={17} />}
                      onClick={() => void navigator.clipboard.writeText(created.onboarding!.link)}
                      variant="outlined"
                    >
                      Copy link
                    </Button>
                    <Button
                      fullWidth
                      startIcon={<Share2 size={17} />}
                      onClick={() =>
                        void (navigator.share
                          ? navigator.share({
                              title: `Set up ${created.name} in Trackify`,
                              text: `Use code ${created.onboarding!.code} to connect ${created.name}.`,
                              url: created.onboarding!.link,
                            })
                          : navigator.clipboard.writeText(created.onboarding!.link))
                      }
                      variant="contained"
                    >
                      Share with driver
                    </Button>
                  </Stack>
                  {invitationStatus === 'waiting' && (
                    <Button color="error" onClick={() => void revokeInvitation()} size="small">
                      Revoke setup link
                    </Button>
                  )}
                  {(invitationStatus === 'expired' || invitationStatus === 'revoked') && (
                    <Button onClick={() => void createReplacementInvitation()} size="small">
                      Create new setup link
                    </Button>
                  )}
                </Stack>
              </Paper>
            ) : (
              <Alert severity="info" icon={<Radio />} sx={{ textAlign: 'left' }}>
                Configure the physical tracker with its Trackify gateway address. Its status changes
                to online after the first valid GPS update.
              </Alert>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3 }}>
        {!created ? (
          <>
            <Button color="inherit" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={busy || !name.trim()}
              onClick={() => void submit()}
              variant="contained"
            >
              {busy ? 'Adding vehicle…' : 'Add vehicle'}
            </Button>
          </>
        ) : (
          <Button onClick={close} variant="contained">
            Go to fleet overview
          </Button>
        )}
      </DialogActions>
      {busy && <LinearProgress sx={{ position: 'absolute', inset: 'auto 0 0' }} />}
    </Dialog>
  );
}

function readTokens() {
  const value = sessionStorage.getItem('tokens');
  return value ? (JSON.parse(value) as Tokens) : undefined;
}
function saveTokens(tokens: Tokens) {
  sessionStorage.setItem('tokens', JSON.stringify(tokens));
}

let renewal: Promise<string | undefined> | undefined;

/**
 * Access tokens last an hour. Renews the stored session with its refresh token; callers that
 * expire together share one renewal. Returns the new access token, or undefined if it failed.
 */
function renewStoredSession(): Promise<string | undefined> {
  renewal ??= (async () => {
    try {
      const refreshToken = readTokens()?.refresh_token;
      if (!refreshToken) throw new Error('This sign-in cannot be renewed');
      const next = await auth.refresh(refreshToken);
      saveTokens(next);
      return next.access_token;
    } catch (error) {
      // A network failure is temporary; any other failure means the sign-in is no longer valid.
      if (!(error instanceof TypeError)) sessionStorage.removeItem('tokens');
      return undefined;
    } finally {
      window.dispatchEvent(new Event(sessionEvent));
    }
  })().finally(() => {
    renewal = undefined;
  });
  return renewal;
}

/** fetch() for API routes the shared client does not cover yet; renews an expired session once. */
async function apiFetch(path: string, init: { method?: string } = {}) {
  const send = (token = '') =>
    fetch(`${config.apiUrl}${path}`, { ...init, headers: { authorization: `Bearer ${token}` } });
  const response = await send(readTokens()?.access_token);
  if (response.status !== 401) return response;
  const renewed = await renewStoredSession();
  return renewed ? send(renewed) : response;
}
function signOut() {
  sessionStorage.clear();
  location.reload();
}
