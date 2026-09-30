import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, shadow } from '../theme';

type Kind = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const filled = kind !== 'secondary' && kind !== 'ghost';
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        s[kind],
        (disabled || busy) && s.disabled,
        pressed && s.pressed,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={filled ? 'white' : colors.primary} />
      ) : (
        <Text style={[s.buttonText, !filled && s.buttonTextDark]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.chip, selected && s.chipSelected]}
    >
      <Text style={[s.chipText, selected && s.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Banner({
  text,
  tone = 'warning',
  action,
  onAction,
}: {
  text: string;
  tone?: 'warning' | 'danger' | 'info';
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={[s.banner, s[`banner_${tone}`]]}>
      <Text style={s.bannerText}>{text}</Text>
      {action && onAction && (
        <Pressable onPress={onAction}>
          <Text style={s.bannerAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

/** A full-screen panel for one task (a report, messages), closed with the button or Back. */
export function Sheet({
  visible,
  title,
  closeLabel,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal animationType="slide" visible={visible} onRequestClose={onClose}>
      <SafeAreaView style={s.sheet}>
        <View style={s.sheetHeader}>
          <Text style={s.sheetTitle}>{title}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={s.sheetClose}>{closeLabel}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.sheetBody} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

export const s = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.primary },
  success: { backgroundColor: colors.success },
  danger: { backgroundColor: colors.danger },
  secondary: { backgroundColor: 'white', borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  buttonText: { color: 'white', fontWeight: '800', fontSize: 16 },
  buttonTextDark: { color: colors.primary },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 18, gap: 12, ...shadow },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'white',
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: '700' },
  chipTextSelected: { color: 'white' },
  banner: { borderRadius: 14, padding: 14, gap: 8 },
  banner_warning: { backgroundColor: '#FFFAEB', borderWidth: 1, borderColor: '#FEDF89' },
  banner_danger: { backgroundColor: '#FEF3F2', borderWidth: 1, borderColor: '#FECDCA' },
  banner_info: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: '#B2CCFF' },
  bannerText: { color: colors.text, lineHeight: 20 },
  bannerAction: { color: colors.primary, fontWeight: '800' },
  sheet: { flex: 1, backgroundColor: colors.background },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    height: 64,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: colors.text, flex: 1 },
  sheetClose: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  sheetBody: { padding: 18, gap: 16 },
  label: { fontSize: 13, fontWeight: '700', color: '#344054', marginBottom: 6 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: 'white',
    fontSize: 16,
  },
  muted: { color: colors.muted, lineHeight: 20 },
  error: { color: colors.danger, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
