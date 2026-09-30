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
import { Banner, Button, Card, s as ui } from '../components/ui';
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
      <View>
        <Text style={st.title}>{t('connectTitle')}</Text>
        <Text style={[ui.muted, { marginTop: 6 }]}>{t('connectBody')}</Text>
      </View>
      <Button busy={busy} onPress={() => void scan()} title={t('scanQr')} />
      <Card>
        <Text style={ui.label}>{t('enterCode')}</Text>
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
          kind="secondary"
          onPress={() => void connect(code)}
          title={busy ? t('connecting') : t('connect')}
        />
      </Card>
      <Text style={[ui.muted, st.center]}>{t('privacyNote')}</Text>
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
  title: { fontSize: 28, fontWeight: '800', color: colors.text },
  code: { fontSize: 24, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  center: { textAlign: 'center' },
  scanner: { flex: 1, backgroundColor: '#07111A' },
});
