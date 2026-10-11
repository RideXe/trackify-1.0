import {
  offlineAfterMs,
  pauseReasons,
  type ActivityEntry,
  type PauseReason,
  type WarningKind,
} from '@trackify/api-client';
import {
  Ambulance,
  CarFront,
  CircleCheck,
  ClipboardCheck,
  Clock3,
  Coffee,
  Fuel,
  Globe,
  MessageSquareText,
  MoonStar,
  Package,
  PhoneCall,
  Play,
  Route,
  Square,
  Timer,
  TriangleAlert,
  User,
  type LucideIcon,
} from '../icons';
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
import { Banner, Button, Card, IconBadge, Sheet, s as ui } from '../components/ui';
import { useStrings, type StringKey } from '../i18n';
import { flushActivity, pendingActivityCount } from '../services/activity-queue';
import { applySettings } from '../services/connection';
import { endShift, pause, pauseExpired, resume, sendSos, startShift } from '../services/duty';
import { checkHealth } from '../services/health';
import {
  fetchMessages,
  isRevoked,
  fetchPhoneSettings,
  fetchToday,
  type TodaySummary,
} from '../services/phone-api';
import {
  loadTrackerConfig,
  readSyncStatus,
  updateTrackerConfig,
  type SyncStatus,
  type TrackerConfig,
} from '../services/storage';
import {
  applySyncInterval,
  isBatteryOptimized,
  openBatterySettings,
  restartTracking,
} from '../services/tracking';
import { colors } from '../theme';
import { CheckSheet, FuelSheet, IssueSheet } from './ReportSheets';
import { MessagesSheet } from './MessagesSheet';

type Panel = 'issue' | 'fuel' | 'check' | 'messages' | 'pause' | 'language';

const SYNC_MS = 60_000;

const pauseIcons: Record<PauseReason, LucideIcon> = {
  break: Coffee,
  fuel: Fuel,
  loading: Package,
  personal: User,
};

/** Colour and icon of the shift card, by duty. */
const dutyLook = {
  on: { color: colors.success, soft: '#ECFDF3', Icon: Play },
  paused: { color: colors.warning, soft: '#FFFAEB', Icon: Coffee },
  off: { color: colors.muted, soft: '#F2F4F7', Icon: MoonStar },
};

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
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({});
  const [batteryOptimized, setBatteryOptimized] = useState(false);
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
        // A new interval from the dashboard applies to running tracking without a restart.
        if (intervalChanged && current.duty.status !== 'off')
          await applySyncInterval(current.intervalSeconds).catch(() => undefined);
        const since = Date.now() - 7 * 86_400_000;
        setMessages(await fetchMessages(current, since));
        await flushActivity(current);
      } catch (error) {
        if (isRevoked(error, current)) return onDisconnected();
        // Offline (or the server has not caught up with a new phone): keep what the phone knows.
      }
      setProblems(await checkHealth(current, true));
      setPending(await pendingActivityCount());
      setSyncStatus(await readSyncStatus());
      setBatteryOptimized(await isBatteryOptimized().catch(() => false));
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
      if (isRevoked(error, await loadTrackerConfig())) return onDisconnected();
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
      if (isRevoked(reason, await loadTrackerConfig())) return onDisconnected();
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
  const onShift = duty.status === 'on';
  const clock = (ms: number) =>
    new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  // Nothing has reached the server for two missed syncs: the tracker is not running. Problems
  // with a known cause (no internet, server) are shown as that instead.
  const lastContact = Math.max(syncStatus.contactAt ?? 0, duty.since ?? 0);
  const silent =
    onShift &&
    lastContact > 0 &&
    Date.now() - lastContact > offlineAfterMs(config.intervalSeconds) &&
    (syncStatus.problem === undefined || syncStatus.problem === 'no-gps');
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
      <View style={st.hero}>
        <View style={st.heroIcon}>
          <CarFront color="white" size={28} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={st.heroVehicle} numberOfLines={1}>
            {config.name}
          </Text>
          <Text style={st.heroLine} numberOfLines={1}>
            {[
              config.driverName,
              config.organisation
                ? t('connectedTo', { organisation: config.organisation })
                : t('connected'),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={t('language')}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setPanel('language')}
          style={st.heroButton}
        >
          <Globe color="white" size={20} />
        </Pressable>
      </View>

      {problems.map((kind) => (
        <Banner
          key={kind}
          tone={kind === 'battery-low' ? 'warning' : 'danger'}
          text={t(`warn_${kind}` as StringKey)}
          action={kind === 'battery-low' ? undefined : t('openSettings')}
          onAction={() => void Linking.openSettings()}
        />
      ))}
      {silent && (
        <Banner
          tone="danger"
          text={t('notSending')}
          action={t('restartTracking')}
          onAction={() =>
            void act(async () => {
              await restartTracking(config);
              await sync();
            })
          }
        />
      )}
      {onShift && !silent && syncStatus.problem && (
        <Banner
          tone={syncStatus.problem === 'no-gps' ? 'warning' : 'danger'}
          text={t(`sync_${syncStatus.problem}` as StringKey)}
        />
      )}
      {duty.status !== 'off' && batteryOptimized && (
        <Banner
          tone="warning"
          text={t('batteryOptimized')}
          action={t('openBatterySettings')}
          onAction={() => void openBatterySettings().catch(() => Linking.openSettings())}
        />
      )}
      {pending > 0 && <Banner tone="info" text={t('pendingSync', { n: pending })} />}

      <Card style={[st.duty, { backgroundColor: dutyLook[duty.status].soft }]}>
        <View style={st.dutyHead}>
          <IconBadge
            icon={dutyLook[duty.status].Icon}
            color="white"
            background={dutyLook[duty.status].color}
            size={52}
          />
          <View style={{ flex: 1 }}>
            <Text style={[st.dutyTitle, { color: dutyLook[duty.status].color }]}>
              {duty.status === 'off'
                ? t('offDuty')
                : duty.status === 'on'
                  ? t('onShift')
                  : t('paused')}
            </Text>
            {duty.status !== 'off' && duty.since ? (
              <View style={st.inline}>
                <Clock3 color={colors.muted} size={14} />
                <Text style={st.since}>{t('since', { time: clock(duty.since) })}</Text>
              </View>
            ) : null}
          </View>
        </View>
        {onShift && syncStatus.positionsAt ? (
          <View style={st.sent}>
            <CircleCheck color={colors.success} size={18} />
            <Text style={st.sentText}>
              {t('lastSent', { time: clock(syncStatus.positionsAt) })}
            </Text>
          </View>
        ) : null}
        <Text style={st.dutyBody}>
          {duty.status === 'off'
            ? t('offDutyBody')
            : duty.status === 'on'
              ? `${t('onShiftBody', { interval })}${
                  syncStatus.positionsAt ? '' : ` ${t('notSentYet')}`
                }`
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
            icon={Play}
            kind="success"
            onPress={() => void act(() => startShift(config))}
            title={t('startShift')}
          />
        )}
        {duty.status === 'on' && (
          <Button
            busy={busy}
            icon={Coffee}
            kind="secondary"
            onPress={() => setPanel('pause')}
            title={t('outside')}
          />
        )}
        {duty.status === 'paused' && (
          <Button
            busy={busy}
            icon={Play}
            kind="success"
            onPress={() => void act(() => resume())}
            title={t('back')}
          />
        )}
        {duty.status !== 'off' && (
          <Button
            disabled={busy}
            icon={Square}
            kind="ghost"
            onPress={confirmEndShift}
            title={t('endShift')}
          />
        )}
      </Card>

      <SosButton
        holdingLabel={t('sosHolding')}
        label={t('sosHold')}
        onTrigger={() => void triggerSos()}
      />

      <View style={st.grid}>
        <Tile
          icon={PhoneCall}
          tone={colors.success}
          label={t('callDispatcher')}
          onPress={callDispatcher}
        />
        <Tile
          badge={unread}
          icon={MessageSquareText}
          tone={colors.primary}
          label={t('messages')}
          onPress={() => void openMessages()}
        />
        <Tile
          icon={TriangleAlert}
          tone={colors.warning}
          label={t('reportIssue')}
          onPress={() => setPanel('issue')}
        />
        <Tile icon={Fuel} tone="#7A5AF8" label={t('fuelLog')} onPress={() => setPanel('fuel')} />
        <Tile
          icon={ClipboardCheck}
          tone="#0E9384"
          label={t('vehicleCheck')}
          onPress={() => setPanel('check')}
        />
        <Tile
          icon={Ambulance}
          tone={colors.danger}
          label={t('call112')}
          onPress={() => void Linking.openURL('tel:112')}
        />
      </View>

      <Card>
        <Text style={st.section}>{t('today')}</Text>
        {today ? (
          <>
            <View style={st.identityRow}>
              <Detail icon={Route} label={t('trips')} value={String(today.trips)} />
              <Detail
                icon={CarFront}
                label={t('distance')}
                value={`${(today.distanceM / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`}
              />
              <Detail icon={Timer} label={t('driving')} value={formatDuration(today.drivingMs)} />
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
            icon={pauseIcons[reason]}
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

function Detail({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <View style={{ flex: 1, minWidth: 90 }}>
      <View style={st.inline}>
        <Icon color={colors.muted} size={14} />
        <Text style={st.detailLabel}>{label}</Text>
      </View>
      <Text style={st.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function Tile({
  label,
  badge,
  icon,
  tone,
  onPress,
}: {
  label: string;
  badge?: number;
  icon: LucideIcon;
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [st.tile, pressed && { opacity: 0.8 }]}
    >
      <IconBadge icon={icon} color={tone} background={`${tone}1A`} size={44} />
      <Text style={st.tileText} numberOfLines={2}>
        {label}
      </Text>
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
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 20,
    backgroundColor: colors.primary,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: 'rgba(15,42,120,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroVehicle: { color: 'white', fontSize: 20, fontWeight: '900' },
  heroLine: { color: 'rgba(255,255,255,0.85)', fontSize: 13, marginTop: 2 },
  heroButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dutyHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  since: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  sent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'white',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sentText: { color: colors.text, fontWeight: '700' },
  detailLabel: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  detailValue: { color: colors.text, fontSize: 16, fontWeight: '800', marginTop: 2 },
  duty: { gap: 12 },
  dutyTitle: { fontSize: 24, fontWeight: '900' },
  dutyBody: { color: colors.muted, lineHeight: 21, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '48.5%',
    minHeight: 108,
    borderRadius: 18,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
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
