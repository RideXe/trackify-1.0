'use client';

import {
  Alert,
  AppBar,
  Avatar,
  Box,
  Button,
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
  Snackbar,
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
  CircleAlert,
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
  QrCode,
  Radio,
  RefreshCw,
  Route,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  SquareParking,
  TriangleAlert,
  Truck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import {
  CognitoPasswordClient,
  TrackifyClient,
  type Device,
  type DeviceState,
  type Driver,
  type FleetAlert,
  type LiveAlert,
  type Tokens,
  type VehicleType,
} from '@trackify/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  overviewCounts,
  overviewFilters,
  overviewVehicles,
  type OverviewFilter,
} from './fleet-views-data';
import { StatTile } from './stat-tile';
import { VehicleRow } from './vehicle-row';
import { FleetMap as FleetMapView } from './fleet-map';
import { noGpsSince, statusColors, vehicleStatus } from './fleet-map-data';
import { AlertsPage, SosBanner } from './alerts';
import { notReporting } from './driver-activity-data';
import { DriversPage } from './drivers';
import { LiveMap } from './live-map';
import { Panel, PanelHead } from './panel';
import { SettingsPage } from './settings';
import { TripsPage } from './trips';
import { VehicleNotFound, VehiclePage } from './vehicle-page';
import { VehicleTypePicker } from './vehicle-icons';
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
  { label: 'Drivers', icon: IdCard, page: 'drivers' },
  { label: 'Alerts', icon: Bell, page: 'alerts' },
  { label: 'Team', icon: Users },
  // Not offered yet; the Trips page stays in the code for when it is.
  { label: 'Trips', icon: Route },
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
  // The latest alert pushed to this user (speeding and other alert rules with "dashboard pop-up").
  const [liveAlert, setLiveAlert] = useState<LiveAlert>();
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
      setError(reason instanceof Error ? reason.message : 'Vehicles unavailable');
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
        const closeAlerts = client.subscribeAlerts(
          nextMembership.tenantId,
          nextMembership.userId,
          setLiveAlert,
        );
        const closeFleet = close;
        close = () => {
          closeFleet();
          closeAlerts();
        };
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

  const admin = membership?.role === 'admin';
  const viewed =
    view.page === 'vehicle'
      ? devices.find((device) => device.deviceId === view.deviceId)
      : undefined;
  const openAlerts = (alerts ?? []).filter((alert) => alert.status === 'open').length;
  const [title, subtitle] =
    view.page === 'drivers'
      ? ['Drivers', 'Who is on shift, their week and their score']
      : view.page === 'live-map'
        ? ['Live map', 'Where every vehicle is right now']
        : view.page === 'trips'
          ? ['Trips', 'Completed journeys across all vehicles']
          : view.page === 'alerts'
            ? ['Alerts', 'SOS, driver reports and phone problems']
            : view.page === 'settings'
              ? ['Settings', 'Your company, location updates and plan']
              : view.page === 'vehicle'
                ? ['Vehicle details', 'Live status, driver and route history']
                : ['Overview', 'Live operations and vehicle health'];
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
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography noWrap variant="h6" sx={{ fontWeight: 700 }}>
              {title}
            </Typography>
            {/* On phones the title alone fits on one line. */}
            <Typography
              color="text.secondary"
              noWrap
              variant="caption"
              sx={{ display: { xs: 'none', sm: 'block' } }}
            >
              {subtitle}
            </Typography>
          </Box>
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
        <Snackbar
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          autoHideDuration={15_000}
          open={Boolean(liveAlert)}
          onClose={(_, reason) => reason !== 'clickaway' && setLiveAlert(undefined)}
          sx={{ mt: { xs: 7, md: 8 } }}
        >
          <Alert
            severity={liveAlert?.type === 'deviceOverspeed' ? 'error' : 'warning'}
            variant="filled"
            onClose={() => setLiveAlert(undefined)}
            action={
              liveAlert && (
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => {
                    go({ page: 'vehicle', deviceId: liveAlert.deviceId });
                    setLiveAlert(undefined);
                  }}
                >
                  View
                </Button>
              )
            }
            sx={{ alignItems: 'center', maxWidth: 420 }}
          >
            <strong>{liveAlert?.title}</strong>
            {liveAlert?.text && liveAlert.text !== liveAlert.title && (
              <Box sx={{ fontSize: 12, opacity: 0.9 }}>{liveAlert.text}</Box>
            )}
          </Alert>
        </Snackbar>
        {loadingFleet ? (
          <Stack
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
          >
            <CircularProgress size={32} />
            <Typography color="text.secondary">Loading your vehicles…</Typography>
          </Stack>
        ) : view.page === 'live-map' ? (
          <LiveMap
            alerts={alerts}
            devices={devices}
            drivers={drivers}
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
            admin={admin}
            alerts={alerts}
            canAcknowledge={membership?.role !== 'viewer'}
            client={client}
            devices={devices}
            drivers={drivers}
            error={alertsError}
            onChanged={loadAlerts}
            onDevicesChanged={loadFleet}
            onOpenVehicle={(deviceId) => go({ page: 'vehicle', deviceId })}
          />
        ) : view.page === 'settings' ? (
          <SettingsPage admin={admin} client={client} />
        ) : view.page === 'drivers' ? (
          <DriversPage
            admin={admin}
            canMessage={membership?.role !== 'viewer'}
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
              connection={(onClose) => (
                <TrackerConnection
                  admin={admin}
                  device={viewed}
                  onClose={onClose}
                  onRefresh={loadFleet}
                />
              )}
              device={viewed}
              devices={devices}
              drivers={drivers}
              driversError={driversError}
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
            alerts={alerts}
            onAdd={() => setOnboardingOpen(true)}
            onAlerts={() => go({ page: 'alerts' })}
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
            Vehicle tracking
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
            Administrator
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
  alerts,
  onAdd,
  onOpen,
  onAlerts,
}: {
  devices: Device[];
  admin: boolean;
  /** The fleet's recent alerts; undefined while loading. */
  alerts?: FleetAlert[];
  onAdd: () => void;
  onOpen: (deviceId: string) => void;
  onAlerts: () => void;
}) {
  const [filter, setFilter] = useState<OverviewFilter>('all');
  const [query, setQuery] = useState('');
  const openAlerts = useMemo(
    () => (alerts ?? []).filter((alert) => alert.status === 'open'),
    [alerts],
  );
  const openAlertIds = useMemo(
    () => new Set(openAlerts.map((alert) => alert.deviceId)),
    [openAlerts],
  );
  if (!devices.length) {
    return <EmptyFleet admin={admin} onAdd={onAdd} />;
  }
  const counts = overviewCounts(devices, openAlertIds);
  const shown = overviewVehicles(devices, filter, query, openAlertIds);
  const unreachable = devices.filter((device) => notReporting(device)).length;
  const attentionParts = [
    unreachable &&
      `${unreachable} ${unreachable === 1 ? 'vehicle' : 'vehicles'} not reachable on shift`,
    openAlerts.length &&
      `${openAlerts.length} open ${openAlerts.length === 1 ? 'alert' : 'alerts'}`,
  ].filter(Boolean);
  const tiles: Array<{ key: OverviewFilter; icon: typeof Truck; tone: string }> = [
    { key: 'all', icon: Truck, tone: '#155EEF' },
    { key: 'moving', icon: Navigation, tone: statusColors.moving },
    { key: 'parked', icon: SquareParking, tone: statusColors.parked },
    { key: 'offline', icon: WifiOff, tone: '#667085' },
    { key: 'attention', icon: TriangleAlert, tone: counts.attention ? '#D92D20' : '#98A2B3' },
  ];
  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'grid',
          // One row everywhere: on phones each tile is just a short label over its number.
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: { xs: 0.75, sm: 1.5 },
        }}
      >
        {tiles.map(({ key, icon, tone }) => (
          <StatTile
            key={key}
            icon={icon}
            label={overviewFilters[key]}
            selected={filter === key}
            tone={tone}
            value={counts[key]}
            // Clicking the selected tile again shows everything.
            onClick={() => setFilter(filter === key && key !== 'all' ? 'all' : key)}
          />
        ))}
      </Box>
      {attentionParts.length > 0 && filter !== 'attention' && (
        <Alert
          severity="warning"
          action={
            <Stack direction="row" spacing={0.5}>
              <Button color="inherit" size="small" onClick={() => setFilter('attention')}>
                Show vehicles
              </Button>
              {openAlerts.length > 0 && (
                <Button color="inherit" size="small" onClick={onAlerts}>
                  Open alerts
                </Button>
              )}
            </Stack>
          }
        >
          {attentionParts.join(' · ')}
        </Alert>
      )}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 360px' },
          gap: 2,
        }}
      >
        <OverviewMap
          devices={shown}
          filter={filter}
          total={devices.length}
          onOpen={onOpen}
          onShowAll={() => {
            setFilter('all');
            setQuery('');
          }}
        />
        {/* Beside the map the list is exactly as tall as the map and scrolls inside. */}
        <Box sx={{ position: 'relative', minWidth: 0 }}>
          <Box sx={{ position: { xl: 'absolute' }, inset: 0, display: 'flex' }}>
            <VehicleList
              devices={shown}
              openAlertIds={openAlertIds}
              query={query}
              onOpen={onOpen}
              onQuery={setQuery}
            />
          </Box>
        </Box>
      </Box>
    </Stack>
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
          <Typography variant="h4">Start tracking your vehicles</Typography>
          <Typography color="text.secondary" sx={{ mt: 1, lineHeight: 1.7 }}>
            {admin
              ? 'Add your first vehicle, connect its GPS identifier, and Trackify will bring every location update into one operational view.'
              : 'Your workspace is ready. Ask an administrator to add the first vehicle.'}
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
            [Bell, 'Vehicle event alerts'],
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

function OverviewMap({
  devices,
  total,
  filter,
  onOpen,
  onShowAll,
}: {
  /** The vehicles the tiles and search currently show. */
  devices: Device[];
  total: number;
  filter: OverviewFilter;
  onOpen: (deviceId: string) => void;
  onShowAll: () => void;
}) {
  const onMap = devices.filter(hasPosition).length;
  const filtered = devices.length !== total;
  return (
    <Paper sx={{ overflow: 'hidden', minWidth: 0 }}>
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }}>Live map</Typography>
          <Typography color="text.secondary" variant="caption">
            {filtered
              ? `Showing ${devices.length} of ${total} · ${overviewFilters[filter]}`
              : onMap
                ? `${onMap} of ${total} vehicles on the map · click a vehicle to open it`
                : 'Waiting for the first GPS signal'}
          </Typography>
        </Box>
        {filtered && (
          <Button size="small" onClick={onShowAll}>
            Show all
          </Button>
        )}
      </Stack>
      <FleetMapView
        devices={devices}
        height={{ xs: 380, xl: 'max(460px, calc(100vh - 300px))' }}
        onSelect={onOpen}
      />
    </Paper>
  );
}

function hasPosition(device: Device) {
  return Number.isFinite(device.state?.latitude) && Number.isFinite(device.state?.longitude);
}
/** Same rule as the map and the server: allows for the vehicle's sync interval. */
function isOnline(device: Device) {
  return vehicleStatus(device) !== 'offline';
}

function VehicleList({
  devices,
  openAlertIds,
  query,
  onQuery,
  onOpen,
}: {
  devices: Device[];
  openAlertIds: ReadonlySet<string>;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (deviceId: string) => void;
}) {
  return (
    <Paper
      sx={{
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: { xs: 360, xl: 0 },
        maxHeight: { xs: 520, xl: 'none' },
      }}
    >
      <Stack spacing={1.5} sx={{ px: 2, pt: 1.75, pb: 1.5 }}>
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Typography sx={{ fontWeight: 700 }}>Vehicles</Typography>
          <Typography color="text.secondary" variant="caption">
            {devices.length} shown
          </Typography>
        </Stack>
        <TextField
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search by name or GPS number"
          size="small"
          value={query}
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
      <List disablePadding sx={{ flex: 1, overflowY: 'auto' }}>
        {!devices.length && (
          <Typography color="text.secondary" sx={{ p: 3, fontSize: 13, textAlign: 'center' }}>
            No vehicles match.
          </Typography>
        )}
        {devices.map((device) => (
          <VehicleRow
            key={device.deviceId}
            alert={openAlertIds.has(device.deviceId)}
            device={device}
            onClick={() => onOpen(device.deviceId)}
          />
        ))}
      </List>
    </Paper>
  );
}

/** Whether the vehicle's tracker (usually the driver's phone) is connected, and pairing it. */
type StatusTone = 'good' | 'attention' | 'problem' | 'idle';

const statusStyle: Record<
  StatusTone,
  { color: string; background: string; Icon: typeof CheckCircle2 }
> = {
  good: { color: '#079455', background: '#ECFDF3', Icon: CheckCircle2 },
  attention: { color: '#B54708', background: '#FFFAEB', Icon: Clock3 },
  problem: { color: '#D92D20', background: '#FEF3F2', Icon: CircleAlert },
  idle: { color: '#475467', background: '#F2F4F7', Icon: Smartphone },
};

/** One plain-language line on whether tracking works, and what to do if it does not. */
function ConnectionStatus({
  tone,
  title,
  detail,
}: {
  tone: StatusTone;
  title: string;
  detail: string;
}) {
  const { color, background, Icon } = statusStyle[tone];
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{ p: 1.5, borderRadius: '12px', bgcolor: background, alignItems: 'flex-start' }}
    >
      <Box sx={{ color, display: 'flex', pt: 0.2 }}>
        <Icon size={20} />
      </Box>
      <Box>
        <Typography sx={{ fontWeight: 800, fontSize: 14, color }}>{title}</Typography>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>{detail}</Typography>
      </Box>
    </Stack>
  );
}

/** The driver's phone: connected or not, sharing or not, and what the admin can do about it. */
function phoneStatus(
  device: Device,
  connection?: DeviceInvitation['status'],
): { tone: StatusTone; title: string; detail: string } {
  if (isOnline(device) && noGpsSince(device) !== undefined)
    return {
      tone: 'attention',
      title: 'Connected, but no GPS signal',
      detail:
        "The phone is working but can't find its location (often indoors). It updates once the vehicle is outside.",
    };
  if (isOnline(device))
    return {
      tone: 'good',
      title: 'Working',
      detail: "The driver's phone is sharing this vehicle's location.",
    };
  if (connection === 'activated') {
    if (device.dutyStatus === 'on')
      return {
        tone: 'problem',
        title: 'Phone not sending',
        detail:
          'The driver is on shift, but the phone stopped sending. Ask the driver to open the Trackify app.',
      };
    if (device.dutyStatus === 'paused')
      return {
        tone: 'idle',
        title: 'Driver on a break',
        detail: 'Location sharing is paused and resumes by itself after the break.',
      };
    return {
      tone: 'idle',
      title: 'Phone connected',
      detail: 'The location appears when the driver taps Start shift in the Trackify app.',
    };
  }
  if (connection === 'waiting')
    return {
      tone: 'attention',
      title: 'Waiting for the driver',
      detail:
        "A setup code was made but hasn't been used yet. Show a new code if the driver lost it.",
    };
  return {
    tone: 'idle',
    title: 'No phone connected',
    detail: "Connect the driver's phone to start tracking this vehicle.",
  };
}

function TrackerConnection({
  device,
  admin,
  onClose,
  onRefresh,
}: {
  device: Device;
  admin: boolean;
  /** Shown as a popup from the vehicle page: adds a close button. */
  onClose?: () => void;
  /** Reloads the vehicle's live status, for "Check again". */
  onRefresh?: () => Promise<void>;
}) {
  const [pairing, setPairing] = useState<DeviceInvitation>();
  const [pairingQr, setPairingQr] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<DeviceInvitation['status']>();
  const [justConnected, setJustConnected] = useState(false);
  const [statusLoaded, setStatusLoaded] = useState(false);
  // "Check again" reloads the connection status at once instead of waiting for the next poll.
  const [checkKey, setCheckKey] = useState(0);
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
    setStatusLoaded(false);
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
        setStatusLoaded(true);
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
  }, [device.deviceId, checkKey]);
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
    <Panel>
      <PanelHead
        icon={<Radio size={18} />}
        title="Connection"
        action={
          onClose && (
            <IconButton aria-label="Close tracker connection" onClick={onClose} size="small">
              <X size={18} />
            </IconButton>
          )
        }
      />
      <Box sx={{ px: { xs: 1.75, sm: 2 }, pb: { xs: 1.75, sm: 2 }, mt: -0.5 }}>
        {!statusLoaded && !isOnline(device) ? (
          <CircularProgress size={22} />
        ) : (
          <>
            <ConnectionStatus {...phoneStatus(device, connectionStatus)} />
            {!isOnline(device) && connectionStatus !== 'activated' && (
              <Box component="ol" sx={{ pl: 2.5, my: 1.5, fontSize: 13, color: 'text.secondary' }}>
                <li>Install the Trackify app on the driver&apos;s phone.</li>
                <li>Open it and scan the code we show you (or type it in).</li>
                <li>The driver taps Start shift. The vehicle appears on the map.</li>
              </Box>
            )}
            <Stack spacing={1} sx={{ mt: 2 }}>
              {!isOnline(device) && connectionStatus !== 'activated' && (
                <Button
                  disabled={pairingBusy}
                  onClick={() => void createPairing()}
                  startIcon={<Smartphone size={17} />}
                  variant="contained"
                  sx={{ minHeight: 42 }}
                >
                  {pairingBusy
                    ? 'Preparing…'
                    : connectionStatus === 'waiting'
                      ? 'Show a new setup code'
                      : 'Connect a phone'}
                </Button>
              )}
              {(connectionStatus === 'activated' || isOnline(device)) && admin && (
                <Stack direction="row" spacing={1}>
                  <Button
                    disabled={pairingBusy}
                    fullWidth
                    onClick={() => void createPairing()}
                    variant="outlined"
                  >
                    Use a different phone
                  </Button>
                  <Button
                    color="error"
                    disabled={pairingBusy}
                    fullWidth
                    onClick={() => void disconnectPhone()}
                  >
                    Disconnect
                  </Button>
                </Stack>
              )}
              <Button
                color="inherit"
                disabled={pairingBusy}
                onClick={() => {
                  setCheckKey((value) => value + 1);
                  void onRefresh?.();
                }}
                startIcon={<RefreshCw size={16} />}
                sx={{ alignSelf: 'center', color: 'text.secondary' }}
              >
                Check again
              </Button>
            </Stack>
          </>
        )}
        {justConnected && (
          <Alert severity="success" sx={{ mt: 2 }} onClose={() => setJustConnected(false)}>
            Phone connected. The location appears once the driver taps Start shift.
          </Alert>
        )}
        {pairingError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {pairingError}
          </Alert>
        )}
      </Box>
      <Dialog open={Boolean(pairing)} onClose={() => setPairing(undefined)} fullWidth maxWidth="xs">
        <DialogTitle component="div">
          <Typography component="h2" variant="h5">
            Connect {device.name}
          </Typography>
          <Typography color="text.secondary" variant="body2">
            On the driver&apos;s phone, open Trackify and scan this code, or type it in.
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
              Works once, for the next 24 hours. The driver does not need a password.
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
    </Panel>
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
            label="Realtime vehicle tracking"
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
            Monitor locations, trips, and vehicle events from a secure operations workspace built to
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
              : 'Sign in with the account provided by your administrator.'}
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
          {firstVehicle ? 'Getting started' : 'Vehicle setup'}
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
            Go to overview
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
