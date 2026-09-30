import type { ActivityEntry } from '@trackify/api-client';
import { Text, View } from 'react-native';
import { Card, Sheet, s as ui } from '../components/ui';
import { useStrings } from '../i18n';
import { colors } from '../theme';

/** Messages the fleet sent this vehicle, newest first. */
export function MessagesSheet({
  messages,
  visible,
  onClose,
}: {
  messages: ActivityEntry[];
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useStrings();
  return (
    <Sheet closeLabel={t('close')} onClose={onClose} title={t('messagesTitle')} visible={visible}>
      {!messages.length && <Text style={ui.muted}>{t('noMessages')}</Text>}
      {messages.map((message) => (
        <Card key={message.entryId} style={{ gap: 6 }}>
          <Text style={{ fontSize: 17, color: colors.text, lineHeight: 24 }}>{message.text}</Text>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={ui.muted}>{message.sentBy ?? ''}</Text>
            <Text style={ui.muted}>{new Date(message.receivedAt).toLocaleString()}</Text>
          </View>
        </Card>
      ))}
    </Sheet>
  );
}
