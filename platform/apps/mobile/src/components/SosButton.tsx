import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import { Siren } from '../icons';
import { colors } from '../theme';

const HOLD_MS = 2_000;

/**
 * Sends only after a continuous two-second press, so a pocket or a stray tap cannot raise an
 * emergency. The fill shows how long is left; letting go early cancels.
 */
export function SosButton({
  label,
  holdingLabel,
  disabled,
  onTrigger,
}: {
  label: string;
  holdingLabel: string;
  disabled?: boolean;
  onTrigger: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);

  function start() {
    setHolding(true);
    Vibration.vibrate(40);
    Animated.timing(progress, { toValue: 1, duration: HOLD_MS, useNativeDriver: false }).start(
      ({ finished }) => {
        setHolding(false);
        progress.setValue(0);
        if (!finished) return;
        Vibration.vibrate([0, 200, 100, 200]);
        onTrigger();
      },
    );
  }

  function cancel() {
    progress.stopAnimation();
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={label}
      disabled={disabled}
      onPressIn={start}
      onPressOut={cancel}
      style={[st.button, disabled && st.disabled]}
    >
      <Animated.View
        style={[
          st.fill,
          { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
      <View style={st.content}>
        <View style={st.icon}>
          <Siren color="white" size={28} strokeWidth={2.4} />
        </View>
        <View>
          <Text style={st.sos}>SOS</Text>
          <Text style={st.label}>{holding ? holdingLabel : label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  button: {
    height: 88,
    borderRadius: 20,
    backgroundColor: colors.danger,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: '#912018' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sos: { color: 'white', fontSize: 26, fontWeight: '900', letterSpacing: 3 },
  label: { color: 'white', fontWeight: '700', marginTop: 2 },
});
