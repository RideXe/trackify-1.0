import { useEffect, useRef, useState } from 'react';
import {
  Modal,
  PermissionsAndroid,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Camera } from 'react-native-camera-kit';
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
    // Fits one screen; scrolls only on very small phones or with very large text.
    <ScrollView bounces={false} contentContainerStyle={st.page} keyboardShouldPersistTaps="handled">
      {notice ? <Banner tone="danger" text={notice} /> : null}
      <View style={st.hero}>
        <IconBadge icon={Smartphone} size={56} />
        <Text style={st.title}>{t('connectTitle')}</Text>
      </View>
      <Card style={st.steps}>
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
      <View style={st.or}>
        <View style={st.line} />
        <View style={st.labelRow}>
          <KeyRound color={colors.muted} size={14} />
          <Text style={st.orText}>{t('enterCode')}</Text>
        </View>
        <View style={st.line} />
      </View>
      <View style={st.codeRow}>
        <TextInput
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={40}
          onChangeText={setCode}
          onSubmitEditing={() => void connect(code)}
          placeholder={t('codePlaceholder')}
          placeholderTextColor="#98A2B3"
          style={[ui.input, st.code]}
          value={code}
        />
        <Button
          busy={busy}
          disabled={!code.trim()}
          icon={Link2}
          kind="primary"
          onPress={() => void connect(code)}
          style={st.connect}
          title={t('connect')}
        />
      </View>
      {error ? <Text style={[ui.error, st.center]}>{error}</Text> : null}
      <View style={st.privacy}>
        <ShieldCheck color={colors.success} size={16} />
        <Text style={st.privacyText}>{t('privacyNote')}</Text>
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
  page: { flexGrow: 1, padding: 16, gap: 14, justifyContent: 'center' },
  hero: { alignItems: 'center', gap: 8 },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  steps: { gap: 12, padding: 16 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: 'white', fontWeight: '800', fontSize: 13 },
  stepText: { flex: 1, color: colors.text, fontSize: 14, lineHeight: 20 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  codeRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  code: { flex: 1, fontSize: 20, fontWeight: '800', letterSpacing: 3, textAlign: 'center' },
  connect: { paddingHorizontal: 14 },
  center: { textAlign: 'center' },
  privacy: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 4 },
  privacyText: { flex: 1, color: colors.muted, fontSize: 12, lineHeight: 17 },
  scanner: { flex: 1, backgroundColor: '#07111A' },
});
