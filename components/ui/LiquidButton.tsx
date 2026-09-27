import { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { capsule, colors, type as typeScale } from '../../theme';

import { GlassCapsule } from './LiquidGlass';

/**
 * Primary CTA, the "liquid glass" capsule, using the supplied artwork via
 * GlassCapsule. Use one per screen; everything else is SecondaryButton or IconButton.
 */

export const BUTTON_HEIGHT = 56;
/** Aspect ratio of the source artwork. */
export const BUTTON_ASPECT = 4.92;

type LiquidButtonProps = {
  title: string;
  onPress?: PressableProps['onPress'];
  width?: number;
  height?: number;
  disabled?: boolean;
  /** Disables the button and swaps the label while an action is in flight. */
  loading?: boolean;
  loadingTitle?: string;
  style?: StyleProp<ViewStyle>;
  /** Icon pinned near the right inside edge; the label stays centred in the full width. */
  accessory?: React.ReactNode;
  /** Icon before the label, centred together with it. Unlike `accessory`. */
  leading?: React.ReactNode;
};

export function LiquidButton({
  title,
  onPress,
  width,
  height = BUTTON_HEIGHT,
  disabled = false,
  loading = false,
  loadingTitle,
  style,
  accessory,
  leading,
}: LiquidButtonProps) {
  const off = disabled || loading;
  const press = useRef(new Animated.Value(0)).current;
  const [measured, setMeasured] = useState(width ?? Math.round(height * BUTTON_ASPECT));

  const onIn = useCallback(() => {
    Animated.timing(press, {
      toValue: 1,
      duration: 90,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [press]);

  const onOut = useCallback(() => {
    Animated.spring(press, {
      toValue: 0,
      damping: 14,
      stiffness: 220,
      mass: 0.6,
      useNativeDriver: true,
    }).start();
  }, [press]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (width == null) setMeasured(Math.round(e.nativeEvent.layout.width));
    },
    [width],
  );

  const animated = {
    transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.982] }) }],
    opacity: off ? 0.45 : press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] }),
  };

  return (
    <Animated.View
      onLayout={onLayout}
      style={[styles.shadow, { height }, width ? { width } : styles.grow, style, animated]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: off, busy: loading }}
        disabled={off}
        onPress={onPress}
        onPressIn={onIn}
        onPressOut={onOut}
        style={styles.press}>
        <GlassCapsule width={width ?? measured} height={height} />
        {/* Long labels shrink rather than wrap or clip. The row is inset on both
           sides so a label never runs under the accessory. */}
        <View
          style={[
            styles.labelRow,
            // Inset scales with capsule height so short capsules keep room for the label.
            accessory ? { paddingHorizontal: Math.round(height * 0.62) } : null,
          ]}
          pointerEvents="none">
          {loading ? null : leading}
          <Text
            style={styles.label}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.85}>
            {loading ? (loadingTitle ?? title) : title}
          </Text>
        </View>
        {loading || !accessory ? null : (
          <View
            style={[styles.accessory, { right: Math.round(height * 0.36) }]}
            pointerEvents="none">
            {accessory}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grow: { alignSelf: 'stretch' },
  shadow: {
    shadowColor: colors.light.borderStrong,
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  press: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  accessory: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  label: {
    // Typography comes from the `button` token.
    ...typeScale.button,
    // No lineHeight: adjustsFontSizeToFit doesn't shrink it, so a shrunk label
    // would sit high in the capsule.
    lineHeight: undefined,
    color: capsule.label,
    textAlign: 'center' as const,
    textTransform: 'uppercase' as const,
    includeFontPadding: false,
  },
});
