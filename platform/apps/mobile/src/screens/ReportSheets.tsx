import {
  checkItems,
  issueKinds,
  type CheckItem,
  type CheckResult,
  type IssueKind,
} from '@trackify/api-client';
import { useEffect, useState } from 'react';
import {
  CarFront,
  CircleCheck,
  CircleX,
  Disc3,
  FileText,
  Fuel,
  Gauge,
  CircleQuestionMark,
  IndianRupee,
  Lightbulb,
  OctagonAlert,
  Send,
  Siren,
  TrafficCone,
  Volume2,
  Wrench,
  type LucideIcon,
} from '../icons';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PhotoField } from '../components/PhotoCapture';
import { Button, Card, Chip, IconBadge, Sheet, s as ui } from '../components/ui';
import { useStrings, type StringKey } from '../i18n';
import { sendActivity, type ActivityFields } from '../services/activity-queue';
import { parseDecimal } from '../services/format';
import { uploadPhoto } from '../services/phone-api';
import type { TrackerConfig } from '../services/storage';
import { batteryPct, quickPosition } from '../services/tracking';
import { colors } from '../theme';

const issueIcons: Record<IssueKind, LucideIcon> = {
  breakdown: Wrench,
  'flat-tyre': Disc3,
  accident: Siren,
  traffic: TrafficCone,
  other: CircleQuestionMark,
};

const checkIcons: Record<CheckItem, LucideIcon> = {
  tyres: Disc3,
  lights: Lightbulb,
  brakes: OctagonAlert,
  horn: Volume2,
  mirrors: CarFront,
  documents: FileText,
};

type Props = { config: TrackerConfig; visible: boolean; onClose: () => void };

/**
 * Uploads the photo first (it needs signal); if that fails the driver can still send the report,
 * which is queued like everything else. Resolves false when the driver chose to stay and retry.
 */
function useSubmit(config: TrackerConfig, onDone: () => void) {
  const { t } = useStrings();
  const [busy, setBusy] = useState(false);

  async function send(activity: ActivityFields, photoUri: string | undefined) {
    setBusy(true);
    try {
      let photoKey: string | undefined;
      if (photoUri) {
        try {
          photoKey = await uploadPhoto(config, photoUri);
        } catch {
          const without = await new Promise<boolean>((resolve) =>
            Alert.alert(t('photoFailed'), undefined, [
              { text: t('cancel'), style: 'cancel', onPress: () => resolve(false) },
              { text: t('sendWithout'), onPress: () => resolve(true) },
            ]),
          );
          if (!without) return;
        }
      }
      const [position, battery] = await Promise.all([quickPosition(config, 4_000), batteryPct()]);
      const result = await sendActivity(config, {
        ...activity,
        ...position,
        ...(photoKey ? { photoKey } : {}),
        batteryPct: battery,
        at: Date.now(),
      });
      Alert.alert(result === 'sent' ? t('sent') : t('queued'));
      onDone();
    } catch (reason) {
      Alert.alert(reason instanceof Error ? reason.message : t('retry'));
    } finally {
      setBusy(false);
    }
  }

  return { busy, send };
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useStrings();
  return (
    <View>
      <Text style={ui.label}>{t('details')}</Text>
      <TextInput
        maxLength={500}
        multiline
        onChangeText={onChange}
        style={[ui.input, { minHeight: 96, textAlignVertical: 'top', paddingTop: 12 }]}
        value={value}
      />
    </View>
  );
}

export function IssueSheet({ config, visible, onClose }: Props) {
  const { t } = useStrings();
  const [kind, setKind] = useState<IssueKind>();
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string>();
  const { busy, send } = useSubmit(config, onClose);
  useEffect(() => {
    if (!visible) return;
    setKind(undefined);
    setNote('');
    setPhoto(undefined);
  }, [visible]);

  return (
    <Sheet closeLabel={t('close')} onClose={onClose} title={t('issueTitle')} visible={visible}>
      <Card>
        <Text style={ui.muted}>{t('chooseKind')}</Text>
        <View style={st.choices}>
          {issueKinds.map((option) => {
            const Icon = issueIcons[option];
            const selected = kind === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setKind(option)}
                style={[st.choice, selected && st.choiceSelected]}
              >
                <Icon color={selected ? colors.danger : colors.muted} size={26} />
                <Text style={[st.choiceText, selected && { color: colors.danger }]}>
                  {t(`issue_${option}` as StringKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <NoteField value={note} onChange={setNote} />
        <PhotoField disabled={busy} label={t('issueTitle')} uri={photo} onChange={setPhoto} />
      </Card>
      <Button
        busy={busy}
        disabled={!kind}
        icon={Send}
        kind="danger"
        onPress={() =>
          kind && void send({ type: 'issue', kind, note: note.trim() || undefined }, photo)
        }
        title={t('send')}
      />
    </Sheet>
  );
}

export function FuelSheet({ config, visible, onClose }: Props) {
  const { t } = useStrings();
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [odometer, setOdometer] = useState('');
  const [photo, setPhoto] = useState<string>();
  const [error, setError] = useState('');
  const { busy, send } = useSubmit(config, onClose);
  useEffect(() => {
    if (!visible) return;
    setLitres('');
    setAmount('');
    setOdometer('');
    setPhoto(undefined);
    setError('');
  }, [visible]);

  function submit() {
    const filled = parseDecimal(litres);
    if (filled === undefined || filled <= 0) return setError(t('litresRequired'));
    setError('');
    void send(
      {
        type: 'fuel',
        litres: filled,
        amount: parseDecimal(amount),
        odometerKm: parseDecimal(odometer),
      },
      photo,
    );
  }

  return (
    <Sheet closeLabel={t('close')} onClose={onClose} title={t('fuelTitle')} visible={visible}>
      <Card>
        <NumberField icon={Fuel} label={t('litres')} value={litres} onChange={setLitres} />
        <NumberField icon={IndianRupee} label={t('amount')} value={amount} onChange={setAmount} />
        <NumberField icon={Gauge} label={t('odometer')} value={odometer} onChange={setOdometer} />
        <PhotoField disabled={busy} label={t('receipt')} uri={photo} onChange={setPhoto} />
        {error ? <Text style={ui.error}>{error}</Text> : null}
      </Card>
      <Button busy={busy} icon={Send} onPress={submit} title={t('send')} />
    </Sheet>
  );
}

export function CheckSheet({ config, visible, onClose }: Props) {
  const { t } = useStrings();
  const [results, setResults] = useState<Partial<Record<CheckItem, CheckResult>>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const { busy, send } = useSubmit(config, onClose);
  useEffect(() => {
    if (!visible) return;
    setResults({});
    setNote('');
    setError('');
  }, [visible]);

  function submit() {
    if (checkItems.some((item) => !results[item])) return setError(t('checkIncomplete'));
    setError('');
    void send({ type: 'check', items: results, note: note.trim() || undefined }, undefined);
  }

  return (
    <Sheet closeLabel={t('close')} onClose={onClose} title={t('checkTitle')} visible={visible}>
      <Text style={ui.muted}>{t('checkBody')}</Text>
      <Card>
        {checkItems.map((item) => {
          const result = results[item];
          return (
            <View key={item} style={st.checkRow}>
              <IconBadge
                icon={checkIcons[item]}
                size={40}
                color={
                  result === 'issue'
                    ? colors.danger
                    : result === 'ok'
                      ? colors.success
                      : colors.primary
                }
                background={
                  result === 'issue' ? '#FEF3F2' : result === 'ok' ? '#ECFDF3' : colors.primarySoft
                }
              />
              <Text style={st.checkLabel}>{t(`check_${item}` as StringKey)}</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {(['ok', 'issue'] as const).map((option) => (
                  <Chip
                    key={option}
                    icon={option === 'ok' ? CircleCheck : CircleX}
                    label={option === 'ok' ? t('ok') : t('problem')}
                    selected={result === option}
                    onPress={() => setResults((current) => ({ ...current, [item]: option }))}
                  />
                ))}
              </View>
            </View>
          );
        })}
        <NoteField value={note} onChange={setNote} />
        {error ? <Text style={ui.error}>{error}</Text> : null}
      </Card>
      <Button busy={busy} icon={Send} onPress={submit} title={t('send')} />
    </Sheet>
  );
}

function NumberField({
  label,
  value,
  icon: Icon,
  onChange,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  onChange: (value: string) => void;
}) {
  return (
    <View>
      <View style={st.labelRow}>
        <Icon color={colors.muted} size={16} />
        <Text style={[ui.label, { marginBottom: 0 }]}>{label}</Text>
      </View>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={onChange}
        style={ui.input}
        value={value}
      />
    </View>
  );
}

const st = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: {
    width: '47.5%',
    minHeight: 84,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 10,
  },
  choiceSelected: { borderColor: colors.danger, backgroundColor: '#FEF3F2' },
  choiceText: { fontWeight: '700', color: colors.text, textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  checkLabel: { flex: 1, minWidth: 90, fontWeight: '700', fontSize: 16, color: colors.text },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
});
