import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { BrandHeader } from './components/BrandHeader';
import { loadLanguage, useStrings } from './i18n';
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
  const { t } = useStrings();
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
    <SafeAreaView style={styles.app}>
      <StatusBar barStyle="dark-content" backgroundColor="white" />
      <BrandHeader caption={t('appCaption')} />
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
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
