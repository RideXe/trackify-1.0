import { useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, Vibration, View } from 'react-native';
import type { LucideIcon } from '../icons';
import { colors } from '../theme';

/**
 * Acts only after the button is held down, so it cannot happen by accident, yet is quicker than
 * a tap plus a pop-up question. The fill shows how long is left; letting go early cancels.
 */
export function HoldButton({
  title,
  holdingTitle,
  icon: Icon,
  holdMs = 1_000,
  disabled,
  onTrigger,
}: {
  title: string;
  holdingTitle: string;
  icon: LucideIcon;
  holdMs?: number;
  disabled?: boolean;
  onTrigger: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  const [holding, setHolding] = useState(false);

  function start() {
    setHolding(true);
    Vibration.vibrate(20);
    Animated.timing(progress, { toValue: 1, duration: holdMs, useNativeDriver: false }).start(
      ({ finished }) => {
        setHolding(false);
        progress.setValue(0);
        if (!finished) return;
        Vibration.vibrate(60);
        onTrigger();
      },
    );
  }

  return (
    <Pressable
      accessibilityHint={holdingTitle}
      accessibilityRole="button"
      disabled={disabled}
      onPressIn={start}
      onPressOut={() => progress.stopAnimation()}
      style={[st.button, disabled && { opacity: 0.5 }]}
    >
      <Animated.View
        style={[
          st.fill,
          { width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
        ]}
      />
      <View style={st.row}>
        <Icon color={holding ? 'white' : colors.danger} size={20} strokeWidth={2.4} />
        <Text style={[st.text, holding && { color: 'white' }]} numberOfLines={1}>
          {holding ? holdingTitle : title}
        </Text>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  button: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#FECDCA',
    backgroundColor: 'white',
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.danger },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  text: { color: colors.danger, fontWeight: '800', fontSize: 15 },
});
