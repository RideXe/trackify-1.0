import type { ActivityEntry } from '@trackify/api-client';
import { Inbox, MessageSquareText } from '../icons';
import { StyleSheet, Text, View } from 'react-native';
import { Card, IconBadge, Sheet, s as ui } from '../components/ui';
import { useStrings } from '../i18n';
import { colors } from '../theme';

/** Messages the office sent this vehicle, newest first. */
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
      {!messages.length && (
        <View style={st.empty}>
          <IconBadge icon={Inbox} color={colors.muted} background="#EAECF0" size={64} />
          <Text style={[ui.muted, { textAlign: 'center' }]}>{t('noMessages')}</Text>
        </View>
      )}
      {messages.map((message) => (
        <Card key={message.entryId} style={st.message}>
          <IconBadge icon={MessageSquareText} size={40} />
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={st.text}>{message.text}</Text>
            <Text style={st.meta}>
              {[
                message.sentBy,
                new Date(message.receivedAt).toLocaleString([], {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </Card>
      ))}
    </Sheet>
  );
}

const st = StyleSheet.create({
  empty: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  message: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  text: { fontSize: 17, color: colors.text, lineHeight: 24, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 13 },
});
