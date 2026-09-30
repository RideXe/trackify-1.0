import {
  pauseReasons,
  type ActivityEntry,
  type PauseReason,
  type WarningKind,
} from '@trackify/api-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LanguagePicker } from '../components/LanguagePicker';
import { SosButton } from '../components/SosButton';
import { Banner, Button, Card, Sheet, s as ui } from '../components/ui';
import { useStrings, type StringKey } from '../i18n';
import { flushActivity, pendingActivityCount } from '../services/activity-queue';
import { applySettings } from '../services/connection';
import { endShift, pause, pauseExpired, resume, sendSos, startShift } from '../services/duty';
import { checkHealth } from '../services/health';
import {
  DisconnectedError,
  fetchMessages,
  fetchPhoneSettings,
  fetchToday,
  type TodaySummary,
} from '../services/phone-api';
import { loadTrackerConfig, updateTrackerConfig, type TrackerConfig } from '../services/storage';
import { startTracking } from '../services/tracking';
import { colors } from '../theme';
import { CheckSheet, FuelSheet, IssueSheet } from './ReportSheets';
import { MessagesSheet } from './MessagesSheet';

type Panel = 'issue' | 'fuel' | 'check' | 'messages' | 'pause' | 'language';

const SYNC_MS = 60_000;

export function HomeScreen({
  initial,
  onDisconnected,
}: {
  initial: TrackerConfig;
  onDisconnected: () => void;
}) {
  const { t } = useStrings();
  const [config, setConfig] = useState(initial);
  const [panel, setPanel] = useState<Panel>();
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<WarningKind[]>([]);
  const [messages, setMessages] = useState<ActivityEntry[]>([]);
  const [today, setToday] = useState<TodaySummary | null>();
  const [pending, setPending] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0);
  const syncing = useRef(false);

  const reload = useCallback(async () => {
    const next = await loadTrackerConfig();
    setConfig(next);
    return next;
  }, []);

  /** Everything the app keeps in step with the server; any 401 means the admin disconnected us. */
  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      let current = await loadTrackerConfig();
      if (!current.credential) return onDisconnected();
      if (pauseExpired(current.duty)) {
        await resume(true);
        current = await loadTrackerConfig();
      }
      try {
        const settings = await fetchPhoneSettings(current);
        const intervalChanged = settings.trackerIntervalSeconds !== current.intervalSeconds;
        current = await applySettings(settings);
        // A new interval from the dashboard takes effect by restarting the tracker (foreground only).
        if (intervalChanged && current.duty.status !== 'off')
          await startTracking(current).catch(() => undefined);
        const since = Date.now() - 7 * 86_400_000;
        setMessages(await fetchMessages(current, since));
        await flushActivity(current);
      } catch (error) {
        if (error instanceof DisconnectedError) return onDisconnected();
        // Offline: keep going with what the phone already knows.
      }
      setProblems(await checkHealth(current, true));
      setPending(await pendingActivityCount());
      setConfig(await loadTrackerConfig());
    } finally {
      syncing.current = false;
    }
  }, [onDisconnected]);

  const loadToday = useCallback(async () => {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    try {
      setToday(await fetchToday(await loadTrackerConfig(), midnight.getTime()));
    } catch (error) {
      if (error instanceof DisconnectedError) return onDisconnected();
      setToday(null);
    }
  }, [onDisconnected]);

  useEffect(() => {
    void sync();
    void loadToday();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void sync();
    }, SYNC_MS);
    const todayTimer = setInterval(() => {
      if (AppState.currentState === 'active') void loadToday();
    }, 5 * SYNC_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    return () => {
      clearInterval(timer);
      clearInterval(todayTimer);
      subscription.remove();
    };
  }, [sync, loadToday]);

  // The pause countdown and "resumes at" need a clock only while paused.
  useEffect(() => {
    if (config.duty.status !== 'paused') return;
    const timer = setInterval(() => {
      setTick((value) => value + 1);
      if (pauseExpired(config.duty)) void sync();
    }, 15_000);
    return () => clearInterval(timer);
  }, [config.duty, sync]);

  async function act(action: () => Promise<'sent' | 'queued' | void>) {
    setBusy(true);
    try {
      const result = await action();
      if (result === 'queued') Alert.alert(t('queued'));
    } catch (reason) {
      if (reason instanceof DisconnectedError) return onDisconnected();
      Alert.alert(t('shiftFailed'), reason instanceof Error ? reason.message : undefined);
    } finally {
      await reload();
      setPending(await pendingActivityCount());
      setBusy(false);
    }
  }

  function confirmEndShift() {
    Alert.alert(t('endShift'), t('endShiftConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('endShift'),
        style: 'destructive',
        onPress: () => void act(() => endShift()),
      },
    ]);
  }

  async function triggerSos() {
    const result = await sendSos(config).catch(() => 'queued' as const);
    setPending(await pendingActivityCount());
    const buttons = [
      { text: t('call112'), onPress: () => void Linking.openURL('tel:112') },
      ...(config.dispatcherPhone
        ? [{ text: t('callDispatcher'), onPress: () => callDispatcher() }]
        : []),
      { text: t('close'), style: 'cancel' as const },
    ];
    Alert.alert('SOS', result === 'sent' ? t('sosSent') : t('sosQueued'), buttons);
  }

  function callDispatcher() {
    if (!config.dispatcherPhone) return Alert.alert(t('noDispatcher'));
    void Linking.openURL(`tel:${config.dispatcherPhone.replace(/[^\d+]/g, '')}`);
  }

  async function openMessages() {
    setPanel('messages');
    const newest = messages[0]?.receivedAt;
    if (newest) setConfig(await updateTrackerConfig((c) => ({ ...c, lastReadMessageAt: newest })));
  }

  const duty = config.duty;
  const unread = messages.filter((message) => message.receivedAt > config.lastReadMessageAt).length;
  const interval =
    config.intervalSeconds >= 60
      ? t('everyMinutes', { n: Math.round(config.intervalSeconds / 60) })
      : t('everySeconds', { n: config.intervalSeconds });

  return (
    <ScrollView
      contentContainerStyle={st.page}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void Promise.all([sync(), loadToday()]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      <Card style={st.identity}>
        <Text style={st.organisation}>
          {config.organisation
            ? t('connectedTo', { organisation: config.organisation })
            : t('connected')}
        </Text>
        <View style={st.identityRow}>
          <Detail label={t('vehicle')} value={config.name} />
          {config.driverName && <Detail label={t('driver')} value={config.driverName} />}
        </View>
        <Pressable onPress={() => setPanel('language')} hitSlop={8}>
          <Text style={st.link}>{t('language')}</Text>
        </Pressable>
      </Card>

      {problems.map((kind) => (
        <Banner
          key={kind}
          tone={kind === 'battery-low' ? 'warning' : 'danger'}
          text={t(`warn_${kind}` as StringKey)}
          action={kind === 'battery-low' ? undefined : t('openSettings')}
          onAction={() => void Linking.openSettings()}
        />
      ))}
      {pending > 0 && <Banner tone="info" text={t('pendingSync', { n: pending })} />}

      <Card style={[st.duty, st[`duty_${duty.status}`]]}>
        <Text style={st.dutyTitle}>
          {duty.status === 'off' ? t('offDuty') : duty.status === 'on' ? t('onShift') : t('paused')}
        </Text>
        <Text style={st.dutyBody}>
          {duty.status === 'off'
            ? t('offDutyBody')
            : duty.status === 'on'
              ? t('onShiftBody', { interval })
              : t('pausedBody', {
                  reason: t(`reason_${duty.reason ?? 'break'}` as StringKey),
                  time: duty.until
                    ? new Date(duty.until).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '',
                })}
        </Text>
        {duty.status === 'off' && (
          <Button
            busy={busy}
            kind="success"
            onPress={() => void act(() => startShift(config))}
            title={t('startShift')}
          />
        )}
        {duty.status === 'on' && (
          <Button
            busy={busy}
            kind="secondary"
            onPress={() => setPanel('pause')}
            title={t('outside')}
          />
        )}
        {duty.status === 'paused' && (
          <Button
            busy={busy}
            kind="success"
            onPress={() => void act(() => resume())}
            title={t('back')}
          />
        )}
        {duty.status !== 'off' && (
          <Button disabled={busy} kind="ghost" onPress={confirmEndShift} title={t('endShift')} />
        )}
      </Card>

      <SosButton
        holdingLabel={t('sosHolding')}
        label={t('sosHold')}
        onTrigger={() => void triggerSos()}
      />

      <View style={st.grid}>
        <Tile label={t('callDispatcher')} onPress={callDispatcher} />
        <Tile badge={unread} label={t('messages')} onPress={() => void openMessages()} />
        <Tile label={t('reportIssue')} onPress={() => setPanel('issue')} />
        <Tile label={t('fuelLog')} onPress={() => setPanel('fuel')} />
        <Tile label={t('vehicleCheck')} onPress={() => setPanel('check')} />
        <Tile label={t('call112')} onPress={() => void Linking.openURL('tel:112')} />
      </View>

      <Card>
        <Text style={st.section}>{t('today')}</Text>
        {today ? (
          <>
            <View style={st.identityRow}>
              <Detail label={t('trips')} value={String(today.trips)} />
              <Detail
                label={t('distance')}
                value={`${(today.distanceM / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`}
              />
              <Detail label={t('driving')} value={formatDuration(today.drivingMs)} />
            </View>
            <Text style={ui.muted}>{t('todayNote')}</Text>
          </>
        ) : (
          <Text style={ui.muted}>{today === null ? t('todayUnavailable') : '…'}</Text>
        )}
      </Card>

      <Sheet
        closeLabel={t('close')}
        onClose={() => setPanel(undefined)}
        title={t('pauseTitle')}
        visible={panel === 'pause'}
      >
        <Text style={ui.muted}>{t('pauseLimitNote', { minutes: config.pauseLimitMinutes })}</Text>
        {pauseReasons.map((reason: PauseReason) => (
          <Button
            key={reason}
            kind="secondary"
            onPress={() => {
              setPanel(undefined);
              void act(() => pause(reason));
            }}
            title={t(`reason_${reason}` as StringKey)}
          />
        ))}
      </Sheet>
      <Sheet
        closeLabel={t('close')}
        onClose={() => setPanel(undefined)}
        title={t('language')}
        visible={panel === 'language'}
      >
        <LanguagePicker />
      </Sheet>
      <IssueSheet
        config={config}
        visible={panel === 'issue'}
        onClose={() => {
          setPanel(undefined);
          void reload();
        }}
      />
      <FuelSheet config={config} visible={panel === 'fuel'} onClose={() => setPanel(undefined)} />
      <CheckSheet config={config} visible={panel === 'check'} onClose={() => setPanel(undefined)} />
      <MessagesSheet
        messages={messages}
        visible={panel === 'messages'}
        onClose={() => setPanel(undefined)}
      />
    </ScrollView>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, minWidth: 90 }}>
      <Text style={st.detailLabel}>{label}</Text>
      <Text style={st.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Tile({ label, badge, onPress }: { label: string; badge?: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [st.tile, pressed && { opacity: 0.8 }]}
    >
      <Text style={st.tileText}>{label}</Text>
      {badge ? (
        <View style={st.badge}>
          <Text style={st.badgeText}>{badge}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function formatDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

const st = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 32 },
  identity: { gap: 10 },
  organisation: { fontSize: 18, fontWeight: '800', color: colors.text },
  identityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  link: { color: colors.primary, fontWeight: '700' },
  detailLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  detailValue: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 2 },
  duty: { gap: 10 },
  duty_off: { backgroundColor: 'white' },
  duty_on: { backgroundColor: '#ECFDF3' },
  duty_paused: { backgroundColor: '#FFFAEB' },
  dutyTitle: { fontSize: 24, fontWeight: '900', color: colors.text },
  dutyBody: { color: colors.muted, lineHeight: 21, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48.5%',
    minHeight: 76,
    borderRadius: 16,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    justifyContent: 'center',
  },
  tileText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: 'white', fontWeight: '800', fontSize: 12 },
  section: { fontSize: 17, fontWeight: '800', color: colors.text },
});
