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
import { CircleAlert, Info, TriangleAlert, X, type LucideIcon } from '../icons';
import { colors, shadow } from '../theme';

type Kind = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  icon: Icon,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: Kind;
  disabled?: boolean;
  busy?: boolean;
  /** Shown before the title. */
  icon?: LucideIcon;
  style?: StyleProp<ViewStyle>;
}) {
  const filled = kind !== 'secondary' && kind !== 'ghost';
  const tint = filled ? 'white' : kind === 'ghost' ? colors.muted : colors.primary;
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
        <View style={s.buttonRow}>
          {Icon && <Icon color={tint} size={20} strokeWidth={2.4} />}
          <Text style={[s.buttonText, { color: tint }]}>{title}</Text>
        </View>
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
  icon: Icon,
  onPress,
}: {
  label: string;
  selected?: boolean;
  icon?: LucideIcon;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.chip, selected && s.chipSelected]}
    >
      {Icon && <Icon color={selected ? 'white' : colors.muted} size={17} />}
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
  const { Icon, color } = bannerIcons[tone];
  return (
    <View style={[s.banner, s[`banner_${tone}`]]}>
      <Icon color={color} size={22} />
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={s.bannerText}>{text}</Text>
        {action && onAction && (
          <Pressable onPress={onAction} hitSlop={8}>
            <Text style={s.bannerAction}>{action}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const bannerIcons = {
  warning: { Icon: TriangleAlert, color: colors.warning },
  danger: { Icon: CircleAlert, color: colors.danger },
  info: { Icon: Info, color: colors.primary },
};

/** A round coloured icon, used on tiles, list rows and headers. */
export function IconBadge({
  icon: Icon,
  color = colors.primary,
  background = colors.primarySoft,
  size = 44,
}: {
  icon: LucideIcon;
  color?: string;
  background?: string;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 3,
        backgroundColor: background,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon color={color} size={size * 0.5} strokeWidth={2.2} />
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
          <Pressable
            accessibilityLabel={closeLabel}
            accessibilityRole="button"
            hitSlop={12}
            onPress={onClose}
            style={s.sheetClose}
          >
            <X color={colors.text} size={22} />
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
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  buttonText: { color: 'white', fontWeight: '800', fontSize: 16 },
  card: { backgroundColor: 'white', borderRadius: 20, padding: 18, gap: 12, ...shadow },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  banner: { borderRadius: 14, padding: 14, gap: 12, flexDirection: 'row' },
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
  sheetClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
