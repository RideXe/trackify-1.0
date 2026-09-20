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
  type Device,
  type Tokens,
} from '@trackify/api-client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';

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

const navItems = [
  { label: 'Overview', icon: Gauge, active: true },
  { label: 'Live map', icon: Map },
  { label: 'Trips', icon: Route },
  { label: 'Alerts', icon: Bell },
  { label: 'Team', icon: Users },
];

export default function FleetPage() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const [tokens, setTokens] = useState<Tokens>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Device>();
  const [membership, setMembership] = useState<Membership>();
  const [challenge, setChallenge] = useState<PasswordChallenge>();
  const [error, setError] = useState('');
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [mobileNav, setMobileNav] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const client = useMemo(() => new TrackifyClient(config, () => tokens?.access_token), [tokens]);
  const auth = useMemo(() => new CognitoPasswordClient(config), []);

  const loadFleet = useCallback(async () => {
    try {
      const result = await client.devices();
      setDevices(result.items);
      setSelected((current) =>
        current ? result.items.find((item) => item.deviceId === current.deviceId) : result.items[0],
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Fleet unavailable');
    } finally {
      setLoadingFleet(false);
    }
  }, [client]);

  useEffect(() => {
    const saved = readTokens();
    if (saved) setTokens(saved);
    else setLoadingFleet(false);
  }, []);

  useEffect(() => {
    if (tokens) void loadFleet();
  }, [tokens, loadFleet]);

  useEffect(() => {
    if (!tokens) return;
    let close: () => void = () => undefined;
    void client
      .me()
      .then((nextMembership) => {
        setMembership(nextMembership);
        close = client.subscribeFleet(nextMembership.tenantId, (update) => {
          setDevices((current) =>
            current.map((device) =>
              device.deviceId === update.deviceId ? { ...device, state: update } : device,
            ),
          );
          setSelected((current) =>
            current?.deviceId === update.deviceId ? { ...current, state: update } : current,
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

  const online = devices.filter((device) => device.state?.status === 'online').length;
  const onboardingVisible =
    onboardingOpen ||
    (!loadingFleet && membership?.role === 'admin' && devices.length === 0 && !onboardingDismissed);

  const drawer = (
    <NavigationDrawer
      email={membership?.email}
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
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Fleet overview
            </Typography>
            <Typography color="text.secondary" variant="caption">
              Live operations and vehicle health
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
        {loadingFleet ? (
          <Stack
            spacing={2}
            sx={{ alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}
          >
            <CircularProgress size={32} />
            <Typography color="text.secondary">Loading your fleet…</Typography>
          </Stack>
        ) : (
          <Dashboard
            devices={devices}
            membership={membership}
            online={online}
            selected={selected}
            client={client}
            onAdd={() => setOnboardingOpen(true)}
            onSelect={setSelected}
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
  onAdd,
  onSignOut,
}: {
  email?: string;
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
        {navItems.map(({ label, icon: Icon, active }) => (
          <ListItemButton
            key={label}
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
          </ListItemButton>
        ))}
      </List>
      <Box sx={{ flex: 1 }} />
      <List sx={{ px: 1.5 }}>
        <ListItemButton sx={{ borderRadius: 2 }}>
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
  membership,
  online,
  selected,
  client,
  onAdd,
  onSelect,
}: {
  devices: Device[];
  membership?: Membership;
  online: number;
  selected?: Device;
  client: TrackifyClient;
  onAdd: () => void;
  onSelect: (device: Device) => void;
}) {
  if (!devices.length) {
    return <EmptyFleet admin={membership?.role === 'admin'} onAdd={onAdd} />;
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
        <MetricCard icon={Bell} label="Open alerts" value={0} tone="#D92D20" />
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: 'minmax(0, 1fr) 360px' },
          gap: 3,
        }}
      >
        <FleetMap devices={devices} selected={selected} onSelect={onSelect} />
        <VehicleList devices={devices} selected={selected} onSelect={onSelect} />
      </Box>
      {selected && <VehicleDetails client={client} device={selected} />}
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

function FleetMap({
  devices,
  selected,
  onSelect,
}: {
  devices: Device[];
  selected?: Device;
  onSelect: (device: Device) => void;
}) {
  const positioned = devices.filter((device) => Number.isFinite(device.state?.latitude));
  return (
    <Paper sx={{ overflow: 'hidden' }}>
      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2.5, py: 2 }}
      >
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Live operations map</Typography>
          <Typography color="text.secondary" variant="caption">
            {positioned.length} vehicles reporting a position
          </Typography>
        </Box>
        <Button size="small" startIcon={<Map size={16} />} variant="outlined">
          Full map
        </Button>
      </Stack>
      <Divider />
      <Box
        sx={{
          position: 'relative',
          minHeight: { xs: 360, md: 500 },
          overflow: 'hidden',
          bgcolor: '#EAF1F5',
          backgroundImage:
            'linear-gradient(32deg, transparent 46%, #D4E0E7 47%, #D4E0E7 49%, transparent 50%), linear-gradient(122deg, transparent 46%, #D4E0E7 47%, #D4E0E7 49%, transparent 50%), radial-gradient(circle at 30% 30%, #F8FAFC 0 9%, transparent 10%), radial-gradient(circle at 75% 66%, #F8FAFC 0 12%, transparent 13%)',
          backgroundSize: '180px 180px, 210px 210px, 360px 360px, 420px 420px',
        }}
      >
        {!positioned.length && (
          <Stack
            spacing={1}
            sx={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}
          >
            <Avatar sx={{ bgcolor: 'white', color: 'text.secondary', boxShadow: 2 }}>
              <Navigation size={20} />
            </Avatar>
            <Typography sx={{ fontWeight: 650 }}>Waiting for the first GPS signal</Typography>
            <Typography color="text.secondary" variant="body2">
              Registered vehicles will appear here automatically.
            </Typography>
          </Stack>
        )}
        {positioned.map((device, index) => (
          <Tooltip key={device.deviceId} title={device.name}>
            <IconButton
              onClick={() => onSelect(device)}
              sx={{
                position: 'absolute',
                left: `${20 + ((index * 23) % 65)}%`,
                top: `${20 + ((index * 31) % 62)}%`,
                bgcolor:
                  selected?.deviceId === device.deviceId ? 'primary.main' : 'background.paper',
                color: selected?.deviceId === device.deviceId ? 'white' : 'primary.main',
                boxShadow: 3,
                '&:hover': { bgcolor: 'primary.dark', color: 'white' },
              }}
            >
              <CarFront size={19} />
            </IconButton>
          </Tooltip>
        ))}
      </Box>
    </Paper>
  );
}

function VehicleList({
  devices,
  selected,
  onSelect,
}: {
  devices: Device[];
  selected?: Device;
  onSelect: (device: Device) => void;
}) {
  return (
    <Paper sx={{ overflow: 'hidden', minHeight: 400 }}>
      <Stack spacing={2} sx={{ px: 2.5, py: 2 }}>
        <Box>
          <Typography sx={{ fontWeight: 700 }}>Vehicles</Typography>
          <Typography color="text.secondary" variant="caption">
            Select a vehicle to see its activity
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
          const active = selected?.deviceId === device.deviceId;
          const online = device.state?.status === 'online';
          return (
            <ListItemButton
              key={device.deviceId}
              onClick={() => onSelect(device)}
              selected={active}
              sx={{ px: 2.5, py: 1.75, borderBottom: 1, borderColor: 'divider' }}
            >
              <Avatar
                sx={{
                  mr: 1.5,
                  bgcolor: active ? 'primary.main' : '#F2F4F7',
                  color: active ? 'white' : 'text.secondary',
                }}
              >
                <CarFront size={19} />
              </Avatar>
              <ListItemText
                primary={device.name}
                secondary={`${Math.round(device.state?.speedKmh ?? 0)} km/h · ${online ? 'Online' : 'Quiet'}`}
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

function VehicleDetails({ device, client }: { device: Device; client: TrackifyClient }) {
  const [activity, setActivity] = useState({ trips: 0, events: 0, distanceKm: 0 });
  const [pairing, setPairing] = useState<DeviceInvitation>();
  const [pairingQr, setPairingQr] = useState('');
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState('');
  useEffect(() => {
    const now = Date.now();
    void Promise.all([
      client.trips(device.deviceId, now - 86_400_000, now),
      client.events(device.deviceId, now - 86_400_000, now),
      client.summary(device.deviceId),
    ]).then(([trips, events, summary]) =>
      setActivity({
        trips: trips.items.length,
        events: events.items.length,
        distanceKm:
          summary.items.reduce((sum, item) => sum + Number(item.distanceM ?? 0), 0) / 1000,
      }),
    );
  }, [client, device.deviceId]);
  async function createPairing() {
    const token = readTokens()?.access_token;
    if (!token) return;
    setPairingBusy(true);
    setPairingError('');
    try {
      const response = await fetch(
        `${config.apiUrl}/devices/${encodeURIComponent(device.deviceId)}/invitations`,
        { method: 'POST', headers: { authorization: `Bearer ${token}` } },
      );
      const invitation = (await response.json()) as DeviceInvitation & { message?: string };
      if (!response.ok) throw new Error(invitation.message || 'Could not create setup code');
      setPairing(invitation);
      setPairingQr(await QRCode.toDataURL(invitation.link, { width: 240, margin: 1 }));
    } catch (reason) {
      setPairingError(reason instanceof Error ? reason.message : 'Could not create setup code');
    } finally {
      setPairingBusy(false);
    }
  }
  return (
    <Paper sx={{ p: 2.5 }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={3}
        sx={{ alignItems: { md: 'center' } }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flex: 1 }}>
          <Avatar sx={{ bgcolor: '#EEF4FF', color: 'primary.main' }}>
            <CarFront size={21} />
          </Avatar>
          <Box>
            <Typography sx={{ fontWeight: 700 }}>{device.name}</Typography>
            <Typography color="text.secondary" variant="body2">
              {device.uniqueId} · {device.protocol.toUpperCase()}
            </Typography>
          </Box>
        </Stack>
        {[
          ['Current speed', `${Math.round(device.state?.speedKmh ?? 0)} km/h`],
          ['Distance today', `${activity.distanceKm.toFixed(1)} km`],
          ['Trips', String(activity.trips)],
          ['Events', String(activity.events)],
        ].map(([label, value]) => (
          <Box key={label} sx={{ minWidth: 110 }}>
            <Typography color="text.secondary" variant="caption">
              {label}
            </Typography>
            <Typography sx={{ fontWeight: 700 }}>{value}</Typography>
          </Box>
        ))}
        <Button
          disabled={pairingBusy}
          onClick={() => void createPairing()}
          startIcon={<Smartphone size={17} />}
          variant="outlined"
        >
          {pairingBusy ? 'Creating…' : 'Connect driver phone'}
        </Button>
      </Stack>
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
}: {
  client: TrackifyClient;
  firstVehicle: boolean;
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState('');
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
      const token = readTokens()?.access_token;
      if (!token) return;
      void fetch(`${config.apiUrl}/devices/${encodeURIComponent(created.deviceId)}/invitations`, {
        headers: { authorization: `Bearer ${token}` },
      })
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value: { items?: DeviceInvitation[] } | undefined) => {
          const current = value?.items?.find(
            (item) => item.invitationId === created.onboarding?.invitationId,
          );
          if (current) setInvitationStatus(current.status);
        });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [created, invitationStatus]);

  async function revokeInvitation() {
    if (!created?.onboarding) return;
    const token = readTokens()?.access_token;
    if (!token) return;
    const result = await fetch(`${config.apiUrl}/invitations/${created.onboarding.invitationId}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    });
    if (result.ok) setInvitationStatus('revoked');
  }

  async function createReplacementInvitation() {
    if (!created) return;
    const token = readTokens()?.access_token;
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch(
        `${config.apiUrl}/devices/${encodeURIComponent(created.deviceId)}/invitations`,
        { method: 'POST', headers: { authorization: `Bearer ${token}` } },
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
                    {invitationStatus === 'activated' && 'Activated · this phone is connected'}
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
function signOut() {
  sessionStorage.clear();
  location.reload();
}
