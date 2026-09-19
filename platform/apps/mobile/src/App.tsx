import {
  CognitoPasswordClient,
  TrackifyClient,
  type Device,
  type Tokens,
} from '@trackify/api-client';
import * as SecureStore from 'expo-secure-store';
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
  const [challenge, setChallenge] = useState<PasswordChallenge>();
  const client = useMemo(() => new TrackifyClient(config, () => tokens?.access_token), [tokens]);
  const auth = useMemo(() => new CognitoPasswordClient(config), []);

  useEffect(() => {
    void SecureStore.getItemAsync('tokens').then((value) => {
      if (value) setTokens(JSON.parse(value) as Tokens);
      setLoading(false);
    });
  }, []);
  useEffect(() => {
    if (tokens)
      void client.devices().then((fleet) => {
        setDevices(fleet.items);
        setSelected(fleet.items[0]);
      });
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
    void client.me().then((membership) => {
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
    });
    return () => close();
  }, [client, tokens]);

  if (loading)
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#ffb44a" />
      </View>
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
        <Text style={styles.live}>{positioned.length} live</Text>
      </View>
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
            coordinate={{ latitude: device.state!.latitude!, longitude: device.state!.longitude! }}
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
              style={[styles.vehicle, selected?.deviceId === item.deviceId && styles.vehicleActive]}
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
    </SafeAreaView>
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
  app: { flex: 1, backgroundColor: '#06131c' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#06131c' },
  login: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#06131c' },
  mark: {
    width: 48,
    height: 48,
    borderWidth: 1,
    borderColor: '#ffb44a',
    color: '#ffb44a',
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    paddingTop: 8,
  },
  hero: {
    color: '#edf0e8',
    fontSize: 48,
    lineHeight: 46,
    fontWeight: '900',
    letterSpacing: -2.5,
    marginTop: 34,
  },
  copy: { color: '#8da0a8', fontSize: 17, lineHeight: 25, marginTop: 22, maxWidth: 320 },
  input: {
    color: '#edf0e8',
    borderWidth: 1,
    borderColor: '#2b4553',
    padding: 15,
    marginTop: 30,
  },
  passwordField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2b4553',
    marginTop: 12,
  },
  passwordInput: { flex: 1, color: '#edf0e8', padding: 15 },
  show: { color: '#ffb44a', fontWeight: '800', padding: 15 },
  error: { color: '#ff877b', marginTop: 12 },
  primary: { backgroundColor: '#ffb44a', padding: 17, marginTop: 20, alignSelf: 'stretch' },
  disabled: { opacity: 0.55 },
  primaryText: { color: '#06131c', fontWeight: '900' },
  top: {
    height: 60,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { color: '#edf0e8', fontSize: 20, fontWeight: '900' },
  live: { color: '#5cd5c4' },
  map: { flex: 1 },
  sheet: { minHeight: 190, padding: 20, backgroundColor: '#081721' },
  heading: { color: '#edf0e8', fontSize: 26, fontWeight: '800', marginBottom: 14 },
  vehicle: { width: 180, padding: 14, marginRight: 8, borderWidth: 1, borderColor: '#1d3542' },
  vehicleActive: { borderColor: '#ffb44a' },
  vehicleName: { color: '#edf0e8', fontWeight: '800', fontSize: 16 },
  meta: { color: '#8da0a8', marginTop: 7 },
  empty: { color: '#8da0a8' },
});
