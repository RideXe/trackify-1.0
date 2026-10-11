import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Globe, Navigation } from '../icons';
import { colors } from '../theme';

export function BrandHeader({
  caption = 'DRIVER APP',
  language,
  onLanguage,
}: {
  caption?: string;
  /** The chosen language's name; tapping opens the language choice. */
  language?: string;
  onLanguage?: () => void;
}) {
  return (
    <View style={s.header}>
      <View style={s.brandRow}>
        <View style={s.logo}>
          <Navigation color="white" fill="white" size={20} />
        </View>
        <View>
          <Text style={s.brand}>Trackify</Text>
          <Text style={s.caption}>{caption}</Text>
        </View>
      </View>
      {onLanguage && (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={onLanguage}
          style={({ pressed }) => [s.language, pressed && { opacity: 0.7 }]}
        >
          <Globe color={colors.primary} size={18} />
          <Text style={s.languageText}>{language}</Text>
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
  brand: { color: colors.text, fontWeight: '800', fontSize: 18 },
  caption: { color: colors.muted, fontWeight: '700', fontSize: 9, letterSpacing: 1.2 },
  language: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primarySoft,
  },
  languageText: { color: colors.primary, fontWeight: '800' },
});
