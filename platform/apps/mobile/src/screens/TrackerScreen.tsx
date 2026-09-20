import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadTrackerConfig, readTrackerLogs, type TrackerConfig } from '../services/storage';
import {
  sendCurrentPosition,
  startTracking,
  stopTracking,
  trackingStatus,
} from '../services/tracking';
import { colors, shadow } from '../theme';

export function TrackerScreen() {
  const [config, setConfig] = useState<TrackerConfig>();
  const [active, setActive] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  useEffect(() => {
    void Promise.all([loadTrackerConfig(), trackingStatus(), readTrackerLogs()]).then(
      ([c, a, l]) => {
        setConfig(c);
        setActive(a);
        setLogs(l);
      },
    );
  }, []);
  async function toggle() {
    if (!config) return;
    try {
      if (active) await stopTracking();
      else await startTracking(config);
      setActive(!active);
      setLogs(await readTrackerLogs());
    } catch (e) {
      Alert.alert('Tracking unavailable', e instanceof Error ? e.message : 'Try again');
    }
  }
  async function locate() {
    if (!config) return;
    try {
      await sendCurrentPosition(config);
      Alert.alert('Position sent');
      setLogs(await readTrackerLogs());
    } catch (e) {
      Alert.alert('Unable to send', e instanceof Error ? e.message : 'Try again');
    }
  }
  return (
    <ScrollView contentContainerStyle={s.page}>
      <Text style={s.title}>Phone tracker</Text>
      <Text style={s.copy}>Use this Android phone as a GPS device.</Text>
      <View style={[s.hero, active && s.active]}>
        <Text style={s.dot}>●</Text>
        <Text style={s.heroTitle}>{active ? 'Tracking is active' : 'Tracker is paused'}</Text>
        <Text style={s.copy}>{config?.uniqueId || 'Complete setup before starting.'}</Text>
        <Pressable style={[s.primary, active && s.stop]} onPress={() => void toggle()}>
          <Text style={s.primaryText}>{active ? 'Stop tracking' : 'Start tracking'}</Text>
        </Pressable>
        <Pressable style={s.secondary} onPress={() => void locate()}>
          <Text style={s.secondaryText}>Send current location</Text>
        </Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.section}>Recent activity</Text>
        {logs.slice(0, 8).map((x) => (
          <Text key={x} style={s.log}>
            {x}
          </Text>
        ))}
        {!logs.length && <Text style={s.copy}>No activity yet.</Text>}
      </View>
    </ScrollView>
  );
}
const s = StyleSheet.create({
  page: { padding: 18, gap: 16 },
  title: { fontSize: 29, fontWeight: '800', color: colors.text },
  copy: { color: colors.muted, lineHeight: 20 },
  hero: {
    padding: 24,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    ...shadow,
  },
  active: { backgroundColor: '#ECFDF3' },
  dot: { fontSize: 34, color: colors.primary },
  heroTitle: { fontSize: 21, fontWeight: '800', color: colors.text, margin: 8 },
  primary: {
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  stop: { backgroundColor: colors.danger },
  primaryText: { color: 'white', fontWeight: '800' },
  secondary: {
    alignSelf: 'stretch',
    backgroundColor: 'white',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: { color: colors.primary, fontWeight: '800' },
  card: { backgroundColor: 'white', padding: 17, borderRadius: 18, ...shadow },
  section: { fontSize: 17, fontWeight: '800', color: colors.text, marginBottom: 10 },
  log: { fontSize: 11, color: colors.muted, fontFamily: 'monospace', marginBottom: 7 },
});
