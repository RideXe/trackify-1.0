import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

export function BrandHeader({ action, onAction }: { action?: string; onAction?: () => void }) {
  return (
    <View style={s.header}>
      <View style={s.brandRow}>
        <View style={s.logo}>
          <Text style={s.logoText}>T</Text>
        </View>
        <View>
          <Text style={s.brand}>Trackify</Text>
          <Text style={s.caption}>FLEET OPERATIONS</Text>
        </View>
      </View>
      {action && (
        <Pressable onPress={onAction}>
          <Text style={s.action}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  header: {
    height: 72,
    paddingHorizontal: 18,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: 'white', fontSize: 21, fontWeight: '900' },
  brand: { color: colors.text, fontWeight: '800', fontSize: 18 },
  caption: { color: colors.muted, fontWeight: '700', fontSize: 9, letterSpacing: 1.2 },
  action: { color: colors.primary, fontWeight: '800' },
});
