import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  PermissionsAndroid,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Camera } from 'react-native-camera-kit';
import { LanguagePicker } from '../components/LanguagePicker';
import { KeyRound, Link2, ScanLine, ShieldCheck, Smartphone } from '../icons';
import { Banner, Button, Card, IconBadge, s as ui } from '../components/ui';
import { useStrings } from '../i18n';
import { connectWithCode, extractCode } from '../services/connection';
import type { TrackerConfig } from '../services/storage';
import { colors } from '../theme';

/** The only thing a new driver can do: scan or type the code their administrator sent. */
export function ConnectScreen({
  initialCode = '',
  notice,
  onConnected,
}: {
  initialCode?: string;
  notice?: string;
  onConnected: (config: TrackerConfig) => void;
}) {
  const { t } = useStrings();
  const [code, setCode] = useState(initialCode);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const redeeming = useRef(false);

  useEffect(() => {
    if (initialCode) void connect(initialCode);
  }, [initialCode]);

  async function connect(raw: string) {
    if (redeeming.current) return;
    const setupCode = extractCode(raw);
    if (!setupCode) {
      setError(t('invalidCode'));
      return;
    }
    redeeming.current = true;
    setScanning(false);
    setBusy(true);
    setError('');
    try {
      onConnected(await connectWithCode(setupCode));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('retry'));
    } finally {
      redeeming.current = false;
      setBusy(false);
    }
  }

  async function scan() {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
    if (result === PermissionsAndroid.RESULTS.GRANTED) setScanning(true);
    else setError(t('cameraNeeded'));
  }

  return (
    <ScrollView contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
      <LanguagePicker />
      {notice ? <Banner tone="danger" text={notice} /> : null}
      <View style={st.hero}>
        <IconBadge icon={Smartphone} size={72} />
        <Text style={st.title}>{t('connectTitle')}</Text>
        <Text style={[ui.muted, st.center]}>{t('connectBody')}</Text>
      </View>
      <Card style={{ gap: 14 }}>
        {(['connectStep1', 'connectStep2', 'connectStep3'] as const).map((key, index) => (
          <View key={key} style={st.step}>
            <View style={st.stepNumber}>
              <Text style={st.stepNumberText}>{index + 1}</Text>
            </View>
            <Text style={st.stepText}>{t(key)}</Text>
          </View>
        ))}
      </Card>
      <Button busy={busy} icon={ScanLine} onPress={() => void scan()} title={t('scanQr')} />
      <Card>
        <View style={st.labelRow}>
          <KeyRound color={colors.muted} size={16} />
          <Text style={[ui.label, { marginBottom: 0 }]}>{t('enterCode')}</Text>
        </View>
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          onChangeText={setCode}
          onSubmitEditing={() => void connect(code)}
          placeholder={t('codePlaceholder')}
          placeholderTextColor="#98A2B3"
          style={[ui.input, st.code]}
          value={code}
        />
        {error ? <Text style={ui.error}>{error}</Text> : null}
        <Button
          busy={busy}
          icon={Link2}
          kind="secondary"
          onPress={() => void connect(code)}
          title={busy ? t('connecting') : t('connect')}
        />
      </Card>
      <View style={st.privacy}>
        <ShieldCheck color={colors.success} size={18} />
        <Text style={[ui.muted, { flex: 1 }]}>{t('privacyNote')}</Text>
      </View>
      <Modal visible={scanning} onRequestClose={() => setScanning(false)}>
        <SafeAreaView style={st.scanner}>
          <Camera
            style={{ flex: 1 }}
            scanBarcode
            allowedBarcodeTypes={['qr']}
            onReadCode={({ nativeEvent }) => void connect(nativeEvent.codeStringValue)}
          />
          <Button
            kind="secondary"
            onPress={() => setScanning(false)}
            style={{ margin: 16 }}
            title={t('cancel')}
          />
        </SafeAreaView>
      </Modal>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  page: { padding: 18, gap: 18 },
  hero: { alignItems: 'center', gap: 10, paddingTop: 8 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, textAlign: 'center' },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: 'white', fontWeight: '800' },
  stepText: { flex: 1, color: colors.text, fontSize: 15, lineHeight: 21 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  privacy: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 },
  code: { fontSize: 24, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  center: { textAlign: 'center' },
  scanner: { flex: 1, backgroundColor: '#07111A' },
});
