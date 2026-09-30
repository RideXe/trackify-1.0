import {
  checkItems,
  issueKinds,
  type CheckItem,
  type CheckResult,
  type IssueKind,
} from '@trackify/api-client';
import { useEffect, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
import { PhotoField } from '../components/PhotoCapture';
import { Button, Card, Chip, Sheet, s as ui } from '../components/ui';
import { useStrings, type StringKey } from '../i18n';
import { sendActivity, type ActivityFields } from '../services/activity-queue';
import { parseDecimal } from '../services/format';
import { uploadPhoto } from '../services/phone-api';
import type { TrackerConfig } from '../services/storage';
import { batteryPct, quickPosition } from '../services/tracking';

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
        <View style={ui.row}>
          {issueKinds.map((option) => (
            <Chip
              key={option}
              label={t(`issue_${option}` as StringKey)}
              selected={kind === option}
              onPress={() => setKind(option)}
            />
          ))}
        </View>
        <NoteField value={note} onChange={setNote} />
        <PhotoField disabled={busy} label={t('issueTitle')} uri={photo} onChange={setPhoto} />
      </Card>
      <Button
        busy={busy}
        disabled={!kind}
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
        <NumberField label={t('litres')} value={litres} onChange={setLitres} />
        <NumberField label={t('amount')} value={amount} onChange={setAmount} />
        <NumberField label={t('odometer')} value={odometer} onChange={setOdometer} />
        <PhotoField disabled={busy} label={t('receipt')} uri={photo} onChange={setPhoto} />
        {error ? <Text style={ui.error}>{error}</Text> : null}
      </Card>
      <Button busy={busy} onPress={submit} title={t('send')} />
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
        {checkItems.map((item) => (
          <View key={item} style={{ gap: 8 }}>
            <Text style={{ fontWeight: '700', fontSize: 16 }}>
              {t(`check_${item}` as StringKey)}
            </Text>
            <View style={ui.row}>
              {(['ok', 'issue'] as const).map((result) => (
                <Chip
                  key={result}
                  label={result === 'ok' ? t('ok') : t('problem')}
                  selected={results[item] === result}
                  onPress={() => setResults((current) => ({ ...current, [item]: result }))}
                />
              ))}
            </View>
          </View>
        ))}
        <NoteField value={note} onChange={setNote} />
        {error ? <Text style={ui.error}>{error}</Text> : null}
      </Card>
      <Button busy={busy} onPress={submit} title={t('send')} />
    </Sheet>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        keyboardType="decimal-pad"
        onChangeText={onChange}
        style={ui.input}
        value={value}
      />
    </View>
  );
}
