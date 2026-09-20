import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { colors, shadow } from '../theme';

export function WelcomeScreen({
  onScan,
  onCode,
  onManual,
  onFleet,
}: {
  onScan: () => void;
  onCode: () => void;
  onManual: () => void;
  onFleet: () => void;
}) {
  return (
    <SafeAreaView style={s.page}>
      <View style={s.top}>
        <View style={s.logo}>
          <Text style={s.logoText}>T</Text>
        </View>
        <Text style={s.brand}>Trackify</Text>
      </View>
      <View style={s.hero}>
        <Text style={s.kicker}>QUICK DEVICE SETUP</Text>
        <Text style={s.title}>Start tracking in a few steps.</Text>
        <Text style={s.copy}>
          Connect this phone using the setup information from your fleet administrator. No account
          login is required.
        </Text>
      </View>
      <View style={s.card}>
        <Choice
          icon="▣"
          title="Scan setup QR"
          copy="Fastest · use the phone camera"
          primary
          onPress={onScan}
        />
        <Choice
          icon="123"
          title="Enter setup code"
          copy="Paste the code sent by your administrator"
          onPress={onCode}
        />
        <Choice
          icon="⌨"
          title="Set up manually"
          copy="Enter the endpoint and device identifier"
          onPress={onManual}
        />
      </View>
      <Pressable onPress={onFleet}>
        <Text style={s.fleet}>
          Fleet administrator? <Text style={s.link}>Sign in</Text>
        </Text>
      </Pressable>
      <Text style={s.privacy}>
        Location sharing only starts after you review permissions and tap Start tracking.
      </Text>
    </SafeAreaView>
  );
}
function Choice({
  icon,
  title,
  copy,
  primary,
  onPress,
}: {
  icon: string;
  title: string;
  copy: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[s.choice, primary && s.choicePrimary]} onPress={onPress}>
      <View style={[s.icon, primary && s.iconPrimary]}>
        <Text style={[s.iconText, primary && s.iconTextPrimary]}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.choiceTitle}>{title}</Text>
        <Text style={s.choiceCopy}>{copy}</Text>
      </View>
      <Text style={s.arrow}>›</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background, padding: 22 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  logo: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: { color: 'white', fontWeight: '900', fontSize: 22 },
  brand: { fontSize: 20, fontWeight: '800', color: colors.text },
  hero: { marginTop: 48, marginBottom: 26 },
  kicker: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: {
    fontSize: 40,
    lineHeight: 43,
    fontWeight: '800',
    letterSpacing: -1.5,
    color: colors.text,
    marginTop: 10,
  },
  copy: { fontSize: 15, lineHeight: 23, color: colors.muted, marginTop: 14 },
  card: { backgroundColor: 'white', borderRadius: 22, padding: 10, gap: 5, ...shadow },
  choice: {
    minHeight: 78,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  choicePrimary: { backgroundColor: colors.primarySoft },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F2F4F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPrimary: { backgroundColor: colors.primary },
  iconText: { fontWeight: '800', color: colors.muted },
  iconTextPrimary: { color: 'white' },
  choiceTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  choiceCopy: { fontSize: 12, color: colors.muted, marginTop: 3 },
  arrow: { fontSize: 27, color: '#98A2B3' },
  fleet: { textAlign: 'center', color: colors.muted, marginTop: 24, fontSize: 14 },
  link: { color: colors.primary, fontWeight: '800' },
  privacy: {
    textAlign: 'center',
    color: '#98A2B3',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 'auto',
  },
});
