import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BrandHeader } from './components/BrandHeader';
import { LanguagePicker } from './components/LanguagePicker';
import { Sheet } from './components/ui';
import { languages, loadLanguage, useStrings } from './i18n';
import { ConnectScreen } from './screens/ConnectScreen';
import { HomeScreen } from './screens/HomeScreen';
import { forgetConnection } from './services/connection';
import { loadTrackerConfig, type TrackerConfig } from './services/storage';
import { colors } from './theme';

/**
 * The driver app: connect with a code, then shifts, SOS and reports. Fleet administrators use the
 * web dashboard; there is no sign-in here.
 */
export default function App() {
  const { t, language } = useStrings();
  const [languageOpen, setLanguageOpen] = useState(false);
  const [config, setConfig] = useState<TrackerConfig>();
  const [loading, setLoading] = useState(true);
  const [setupCode, setSetupCode] = useState('');
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    void Promise.all([loadLanguage(), loadTrackerConfig()])
      .then(([, saved]) => setConfig(saved.credential ? saved : undefined))
      .finally(() => setLoading(false));
    const openLink = (url: string | null) => {
      const code = url
        ?.toUpperCase()
        .match(/(?:ONBOARD[/#?=]+)([A-HJ-NP-Z2-9]{6})(?:$|[^A-Z0-9])/)?.[1];
      if (code) setSetupCode(code);
    };
    void Linking.getInitialURL().then(openLink);
    const subscription = Linking.addEventListener('url', ({ url }) => openLink(url));
    return () => subscription.remove();
  }, []);

  const onDisconnected = useCallback(() => {
    void forgetConnection().then(() => {
      setConfig(undefined);
      setDisconnected(true);
    });
  }, []);

  return (
    // Keeps the header and the SOS button clear of the status and navigation bars on every
    // Android version, including Android 16, which always draws apps edge to edge.
    <SafeAreaProvider>
      <SafeAreaView style={styles.app}>
        <StatusBar barStyle="dark-content" backgroundColor="white" />
        {/* The home screen has its own vehicle header; the brand bar only shows before connecting. */}
        {!config && (
          <BrandHeader
            caption={t('appCaption')}
            language={languages.find((option) => option.code === language)?.label}
            onLanguage={() => setLanguageOpen(true)}
          />
        )}
        <Sheet
          closeLabel={t('close')}
          onClose={() => setLanguageOpen(false)}
          title={t('language')}
          visible={languageOpen}
        >
          <LanguagePicker />
        </Sheet>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : config ? (
          <HomeScreen key={config.deviceId} initial={config} onDisconnected={onDisconnected} />
        ) : (
          <ConnectScreen
            initialCode={setupCode}
            notice={disconnected ? t('disconnectedNotice') : undefined}
            onConnected={(connected) => {
              setDisconnected(false);
              setSetupCode('');
              setConfig(connected);
            }}
          />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
