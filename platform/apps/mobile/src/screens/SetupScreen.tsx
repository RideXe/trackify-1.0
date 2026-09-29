import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  PermissionsAndroid,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Camera } from 'react-native-camera-kit';
import {
  defaultTrackerConfig,
  loadTrackerConfig,
  saveTrackerConfig,
  type TrackerConfig,
} from '../services/storage';
import { colors, shadow } from '../theme';
import { sendCurrentPosition, startTracking } from '../services/tracking';

export function SetupScreen({
  initialMode = 'manual',
  initialCode = '',
  onComplete,
  onCancel,
}: {
  initialMode?: 'scan' | 'code' | 'manual';
  initialCode?: string;
  onComplete?: () => void;
  onCancel?: () => void;
}) {
  const redeemLock = useRef(false);
  const [c, setC] = useState<TrackerConfig>(defaultTrackerConfig);
  const [scan, setScan] = useState(false);
  const [setupCode, setSetupCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [activating, setActivating] = useState(false);
  useEffect(() => {
    void loadTrackerConfig().then((saved) => {
      setC(saved);
      if (initialCode && !saved.credential) void apply(initialCode);
      else if (initialMode === 'scan' && !saved.credential) void requestCamera().then(setScan);
    });
  }, []);
  const set = (k: keyof TrackerConfig, v: string | number | boolean) =>
    setC((x) => ({ ...x, [k]: v }));
  async function apply(raw: string) {
    if (redeemLock.current) return;
    const code = extractCode(raw);
    if (!code) {
      setError('Enter the 6-character setup code or paste the full Trackify link.');
      return;
    }
    redeemLock.current = true;
    setBusy(true);
    setError('');
    setScan(false);
    try {
      const response = await fetch(
        `https://f128plufw8.execute-api.ap-south-1.amazonaws.com/onboard/${encodeURIComponent(code)}/redeem`,
        { method: 'POST' },
      );
      const value = (await response.json().catch(() => ({}))) as Partial<TrackerConfig> & {
        message?: string;
      };
      if (!response.ok) throw new Error(value.message || `Setup failed (${response.status})`);
      if (!value.deviceId || !value.uniqueId || !value.name || !value.endpoint || !value.credential)
        throw new Error('Trackify returned incomplete setup information');
      const connected: TrackerConfig = {
        ...c,
        deviceId: value.deviceId,
        uniqueId: value.uniqueId,
        endpoint: value.endpoint,
        credential: value.credential,
        name: value.name,
      };
      // Persist immediately: the code is already consumed, even before permissions.
      await saveTrackerConfig(connected);
      setC(connected);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to complete setup');
    } finally {
      redeemLock.current = false;
      setBusy(false);
    }
  }
  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.heading}>
        <View>
          <Text style={s.title}>{c.credential ? 'Confirm vehicle' : 'Connect this phone'}</Text>
          <Text style={s.copy}>
            {c.credential
              ? 'Review the vehicle before location sharing starts.'
              : 'Scan the QR or enter the short code sent by your fleet administrator.'}
          </Text>
        </View>
        {onCancel && (
          <Pressable onPress={onCancel}>
            <Text style={s.cancel}>Cancel</Text>
          </Pressable>
        )}
      </View>
      {!c.credential && (
        <View style={s.card}>
          <Text style={s.actionTitle}>Enter setup code</Text>
          <TextInput
            style={[s.input, s.code]}
            value={setupCode}
            onChangeText={setSetupCode}
            autoCapitalize="characters"
            placeholder="AB7MK9 or Trackify setup link"
            placeholderTextColor="#98A2B3"
          />
          {error ? <Text style={s.error}>{error}</Text> : null}
          <Pressable
            disabled={busy}
            style={[s.primary, busy && s.disabled]}
            onPress={() => void apply(setupCode)}
          >
            <Text style={s.primaryText}>{busy ? 'Connecting…' : 'Connect vehicle'}</Text>
          </Pressable>
        </View>
      )}
      {!c.credential && (
        <View style={s.actions}>
          <Pressable
            style={s.action}
            onPress={() => {
              void requestCamera().then((granted) => {
                setScan(granted);
                if (!granted)
                  setError('Camera access is needed to scan. You can enter the code instead.');
              });
            }}
          >
            <Text style={s.actionTitle}>Scan setup QR</Text>
            <Text style={s.copy}>Configure this phone</Text>
          </Pressable>
        </View>
      )}
      {c.credential && (
        <View style={s.card}>
          <View style={s.vehicleIcon}>
            <Text style={s.vehicleEmoji}>🚙</Text>
          </View>
          <Text style={s.vehicleName}>{c.name}</Text>
          <Text style={s.copy}>This phone will securely report location for this vehicle.</Text>
          <Field
            label="Interval seconds"
            value={String(c.intervalSeconds)}
            onChange={(v) => set('intervalSeconds', Number(v) || 30)}
          />
          <View style={s.switch}>
            <Text style={s.actionTitle}>Offline buffer</Text>
            <Switch value={c.buffer} onValueChange={(v) => set('buffer', v)} />
          </View>
          <Pressable
            disabled={activating}
            style={[s.primary, activating && s.disabled]}
            onPress={() => {
              if (!c.uniqueId || !c.endpoint || !c.credential) {
                Alert.alert('Setup incomplete', 'Use a valid setup code first.');
                return;
              }
              setActivating(true);
              setError('');
              void saveTrackerConfig(c)
                .then(async () => {
                  await startTracking(c);
                  await sendCurrentPosition(c);
                  Alert.alert('Tracking started', `${c.name} is now sharing its location.`);
                  onComplete?.();
                })
                .catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : 'Unable to start tracking');
                })
                .finally(() => setActivating(false));
            }}
          >
            <Text style={s.primaryText}>
              {activating ? 'Starting location sharing…' : 'Confirm and start tracking'}
            </Text>
          </Pressable>
          {error ? <Text style={s.error}>{error}</Text> : null}
        </View>
      )}
      <Modal visible={scan} onRequestClose={() => setScan(false)}>
        <SafeAreaView style={s.scanner}>
          {/* Only opened after requestCamera() succeeds. */}
          <Camera
            style={{ flex: 1 }}
            scanBarcode
            allowedBarcodeTypes={['qr']}
            onReadCode={({ nativeEvent }) => void apply(nativeEvent.codeStringValue)}
          />
          <Pressable style={s.primary} onPress={() => setScan(false)}>
            <Text style={s.primaryText}>Cancel</Text>
          </Pressable>
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

async function requestCamera() {
  const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

function extractCode(raw: string) {
  const direct = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (/^[A-HJ-NP-Z2-9]{6}$/.test(direct)) return direct;
  return raw.toUpperCase().match(/(?:ONBOARD[/#?=]+)([A-HJ-NP-Z2-9]{6})(?:$|[^A-Z0-9])/)?.[1] ?? '';
}
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View>
      <Text style={s.label}>{label}</Text>
      <TextInput style={s.input} value={value} onChangeText={onChange} autoCapitalize="none" />
    </View>
  );
}
const s = StyleSheet.create({
  page: { padding: 18, gap: 16 },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cancel: { color: colors.primary, fontWeight: '800', paddingTop: 8 },
  title: { fontSize: 29, fontWeight: '800', color: colors.text },
  copy: { color: colors.muted, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    padding: 16,
    minHeight: 110,
    backgroundColor: 'white',
    borderRadius: 17,
    ...shadow,
  },
  actionTitle: { fontWeight: '800', color: colors.text, marginBottom: 6 },
  card: { padding: 17, backgroundColor: 'white', borderRadius: 18, gap: 13, ...shadow },
  label: { fontSize: 12, fontWeight: '700', color: '#344054', marginBottom: 5 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 11,
    paddingHorizontal: 12,
    color: colors.text,
  },
  code: { minHeight: 100, textAlignVertical: 'top', paddingTop: 12 },
  error: { color: colors.danger, fontSize: 13 },
  disabled: { opacity: 0.55 },
  switch: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  primary: {
    backgroundColor: colors.primary,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  primaryText: { color: 'white', fontWeight: '800' },
  scanner: { flex: 1, backgroundColor: '#07111A', padding: 18 },
  vehicleIcon: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleEmoji: { fontSize: 34 },
  vehicleName: { textAlign: 'center', color: colors.text, fontSize: 24, fontWeight: '900' },
});
