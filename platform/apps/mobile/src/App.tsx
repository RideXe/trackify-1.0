import {
  CognitoPasswordClient,
  TrackifyClient,
  type Device,
  type Tokens,
} from '@trackify/api-client';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { SetupScreen } from './screens/SetupScreen';
import { TrackerScreen } from './screens/TrackerScreen';
import { WelcomeScreen } from './screens/WelcomeScreen';
import { BrandHeader } from './components/BrandHeader';
import { loadTrackerConfig } from './services/storage';
import './tasks/location-task';

const clientId = '2h5u12cj2ro3p8n37fmmhfjcpq';
const config = {
  apiUrl: 'https://f128plufw8.execute-api.ap-south-1.amazonaws.com',
  awsRegion: 'ap-south-1',
  clientId,
  realtimeDns: 'qax2znhhijftphzcymk3fvufqa.appsync-realtime-api.ap-south-1.amazonaws.com',
};

interface PasswordChallenge {
  username: string;
  session: string;
}

export default function App() {
  const [tokens, setTokens] = useState<Tokens>();
  const [devices, setDevices] = useState<Device[]>([]);
  const [selected, setSelected] = useState<Device>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'fleet' | 'tracker' | 'setup'>('tracker');
  const [trackerReady, setTrackerReady] = useState(false);
  const [onboarding, setOnboarding] = useState<'scan' | 'code' | 'manual'>();
  const [onboardingCode, setOnboardingCode] = useState('');
  const [fleetLoginRequested, setFleetLoginRequested] = useState(false);
  const [challenge, setChallenge] = useState<PasswordChallenge>();
  const client = useMemo(() => new TrackifyClient(config, () => tokens?.access_token), [tokens]);
  const auth = useMemo(() => new CognitoPasswordClient(config), []);

  useEffect(() => {
    void restoreSession();
    void Linking.getInitialURL().then(openOnboardingLink);
    const subscription = Linking.addEventListener('url', ({ url }) => openOnboardingLink(url));
    return () => subscription.remove();
  }, []);

  function openOnboardingLink(url: string | null) {
    if (!url) return;
    const code = url
      .toUpperCase()
      .match(/(?:ONBOARD[/#?=]+)([A-HJ-NP-Z2-9]{6})(?:$|[^A-Z0-9])/)?.[1];
    if (!code) return;
    setOnboardingCode(code);
    setOnboarding('code');
  }

  async function restoreSession() {
    try {
      const tracker = await loadTrackerConfig();
      setTrackerReady(Boolean(tracker.uniqueId && tracker.endpoint && tracker.credential));
      const value = await SecureStore.getItemAsync('tokens');
      if (value) setTokens(JSON.parse(value) as Tokens);
    } catch {
      await SecureStore.deleteItemAsync('tokens');
    } finally {
      setLoading(false);
    }
  }

  async function signOut(message = '') {
    await SecureStore.deleteItemAsync('tokens');
    setTokens(undefined);
    setDevices([]);
    setSelected(undefined);
    setError(message);
  }

  useEffect(() => {
    if (tokens) {
      void client
        .devices()
        .then((fleet) => {
          setDevices(fleet.items);
          setSelected(fleet.items[0]);
        })
        .catch(() => void signOut('Your session expired. Please sign in again.'));
    }
  }, [client, tokens]);

  async function signIn(username: string, password: string) {
    setError('');
    try {
      const result = await auth.signIn(username.trim(), password);
      if (result.status === 'new-password-required') {
        setChallenge(result);
        return;
      }
      await persistTokens(result.tokens);
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
      await persistTokens(next);
      setTokens(next);
      setChallenge(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Password update failed');
    }
  }
  useEffect(() => {
    if (!tokens) return;
    let close: () => void = () => undefined;
    void client
      .me()
      .then((membership) => {
        close = client.subscribeFleet(membership.tenantId, (update) => {
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
      .catch(() => void signOut('Your session expired. Please sign in again.'));
    return () => close();
  }, [client, tokens]);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#ffb44a" />
      </View>
    );
  if (onboarding)
    return (
      <SafeAreaView style={styles.publicApp}>
        <BrandHeader />
        <SetupScreen
          initialMode={onboarding}
          initialCode={onboardingCode}
          onCancel={() => setOnboarding(undefined)}
          onComplete={() => {
            setTrackerReady(true);
            setOnboardingCode('');
            setOnboarding(undefined);
            setTab('tracker');
          }}
        />
      </SafeAreaView>
    );
  if (!trackerReady && !tokens && !fleetLoginRequested)
    return (
      <WelcomeScreen
        onScan={() => setOnboarding('scan')}
        onCode={() => setOnboarding('code')}
        onManual={() => setOnboarding('manual')}
        onFleet={() => {
          setFleetLoginRequested(true);
          setTab('fleet');
        }}
      />
    );
  if (!tokens && tab !== 'fleet')
    return (
      <SafeAreaView style={styles.publicApp}>
        <BrandHeader action="Fleet login" onAction={() => setTab('fleet')} />
        <View style={styles.publicContent}>
          {tab === 'tracker' ? (
            <TrackerScreen />
          ) : (
            <SetupScreen
              onComplete={() => {
                setTrackerReady(true);
                setTab('tracker');
              }}
            />
          )}
        </View>
        <PublicNav tab={tab} onChange={setTab} />
      </SafeAreaView>
    );
  if (!tokens)
    return (
      <LoginScreen
        challenge={challenge}
        error={error}
        onSignIn={signIn}
        onSetNewPassword={setNewPassword}
      />
    );
  const positioned = devices.filter((device) => Number.isFinite(device.state?.latitude));
  return (
    <SafeAreaView style={styles.app}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Text style={styles.brand}>Trackify</Text>
        <View style={styles.topActions}>
          <Text style={styles.live}>{positioned.length} live</Text>
          <Pressable accessibilityRole="button" onPress={() => void signOut()}>
            <Text style={styles.signOut}>Sign out</Text>
          </Pressable>
        </View>
      </View>
      {tab === 'tracker' && <TrackerScreen />}
      {tab === 'setup' && <SetupScreen />}
      {tab === 'fleet' && (
        <>
          <MapView
            style={styles.map}
            initialRegion={{
              latitude: positioned[0]?.state?.latitude ?? 12.9716,
              longitude: positioned[0]?.state?.longitude ?? 77.5946,
              latitudeDelta: 0.25,
              longitudeDelta: 0.25,
            }}
          >
            {positioned.map((device) => (
              <Marker
                key={device.deviceId}
                coordinate={{
                  latitude: device.state!.latitude!,
                  longitude: device.state!.longitude!,
                }}
                title={device.name}
                onPress={() => setSelected(device)}
              />
            ))}
          </MapView>
          <View style={styles.sheet}>
            <Text style={styles.heading}>Fleet</Text>
            <FlatList
              horizontal
              data={devices}
              keyExtractor={(item) => item.deviceId}
              renderItem={({ item }) => (
                <Pressable
                  style={[
                    styles.vehicle,
                    selected?.deviceId === item.deviceId && styles.vehicleActive,
                  ]}
                  onPress={() => setSelected(item)}
                >
                  <Text style={styles.vehicleName}>{item.name}</Text>
                  <Text style={styles.meta}>
                    {Math.round(item.state?.speedKmh ?? 0)} km/h · {item.state?.status ?? 'quiet'}
                  </Text>
                </Pressable>
              )}
            />
            {!devices.length && <Text style={styles.empty}>No vehicles have been added yet.</Text>}
          </View>
        </>
      )}
      <View style={styles.nav}>
        {(['fleet', 'tracker', 'setup'] as const).map((item) => (
          <Pressable key={item} style={styles.navItem} onPress={() => setTab(item)}>
            <Text style={[styles.navText, tab === item && styles.navActive]}>{item}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function PublicNav({
  tab,
  onChange,
}: {
  tab: 'fleet' | 'tracker' | 'setup';
  onChange: (tab: 'fleet' | 'tracker' | 'setup') => void;
}) {
  return (
    <View style={styles.nav}>
      {(['tracker', 'setup', 'fleet'] as const).map((item) => (
        <Pressable key={item} style={styles.navItem} onPress={() => onChange(item)}>
          <Text style={[styles.navText, tab === item && styles.navActive]}>{item}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function LoginScreen({
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
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
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
    <SafeAreaView style={styles.login}>
      <StatusBar style="light" />
      <Text style={styles.mark}>T</Text>
      <Text style={styles.hero}>{challenge ? 'Set your new password.' : 'Welcome back.'}</Text>
      <Text style={styles.copy}>
        {challenge
          ? 'Use at least 12 characters with upper/lowercase and a number.'
          : 'Sign in to see every vehicle and live fleet event.'}
      </Text>
      {!challenge && (
        <TextInput
          autoCapitalize="none"
          autoComplete="username"
          keyboardType="email-address"
          onChangeText={setUsername}
          placeholder="Email or username"
          placeholderTextColor="#5f747e"
          style={styles.input}
          value={username}
        />
      )}
      <View style={styles.passwordField}>
        <TextInput
          autoCapitalize="none"
          autoComplete={challenge ? 'new-password' : 'current-password'}
          onChangeText={setPassword}
          placeholder={challenge ? 'New password' : 'Password'}
          placeholderTextColor="#5f747e"
          secureTextEntry={!visible}
          style={styles.passwordInput}
          value={password}
        />
        <Pressable onPress={() => setVisible((current) => !current)}>
          <Text style={styles.show}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable
        disabled={busy || !password || (!challenge && !username)}
        style={[styles.primary, busy && styles.disabled]}
        onPress={() => void submit()}
      >
        <Text style={styles.primaryText}>
          {busy ? 'Please wait…' : challenge ? 'Set password and continue' : 'Sign in'}
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}

async function persistTokens(tokens: Tokens) {
  await SecureStore.setItemAsync('tokens', JSON.stringify(tokens));
}

const styles = StyleSheet.create({
  publicApp: { flex: 1, backgroundColor: '#F5F7FA' },
  publicContent: { flex: 1 },
  app: { flex: 1, backgroundColor: '#F5F7FA' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F7FA' },
  login: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#F5F7FA' },
  mark: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: '#155EEF',
    backgroundColor: '#155EEF',
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    paddingTop: 8,
  },
  hero: {
    color: '#101828',
    fontSize: 48,
    lineHeight: 46,
    fontWeight: '900',
    letterSpacing: -2.5,
    marginTop: 34,
  },
  copy: { color: '#667085', fontSize: 17, lineHeight: 25, marginTop: 22, maxWidth: 320 },
  input: {
    color: '#101828',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D0D5DD',
    padding: 15,
    marginTop: 30,
  },
  passwordField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#D0D5DD',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 12,
  },
  passwordInput: { flex: 1, color: '#101828', padding: 15 },
  show: { color: '#155EEF', fontWeight: '800', padding: 15 },
  error: { color: '#ff877b', marginTop: 12 },
  primary: {
    backgroundColor: '#155EEF',
    padding: 17,
    marginTop: 20,
    alignSelf: 'stretch',
    borderRadius: 12,
  },
  disabled: { opacity: 0.55 },
  primaryText: { color: '#FFFFFF', fontWeight: '900' },
  top: {
    height: 60,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E4E7EC',
  },
  brand: { color: '#101828', fontSize: 20, fontWeight: '900' },
  live: { color: '#039855' },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  signOut: { color: '#155EEF', fontWeight: '800' },
  nav: {
    height: 64,
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E4E7EC',
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navText: { color: '#667085', fontWeight: '700', textTransform: 'capitalize' },
  navActive: { color: '#155EEF' },
  map: { flex: 1 },
  sheet: { minHeight: 190, padding: 20, backgroundColor: '#FFFFFF' },
  heading: { color: '#101828', fontSize: 26, fontWeight: '800', marginBottom: 14 },
  vehicle: {
    width: 180,
    padding: 14,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E4E7EC',
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
  },
  vehicleActive: { borderColor: '#155EEF', borderWidth: 2 },
  vehicleName: { color: '#101828', fontWeight: '800', fontSize: 16 },
  meta: { color: '#667085', marginTop: 7 },
  empty: { color: '#667085' },
});
