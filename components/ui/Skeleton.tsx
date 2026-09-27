import { useEffect, useRef } from 'react';
import { Animated, Easing, View, type DimensionValue } from 'react-native';

import { cx } from './cx';

// Loading placeholder. Prefer it over a spinner when the result's shape is known.
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 8,
  className,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  className?: string;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width, height, borderRadius: radius, opacity: pulse }}
      className={cx('bg-skeleton', className)}
    />
  );
}

export function SkeletonBubble({ className }: { className?: string }) {
  return (
    <View className={cx('w-[84%] gap-xs rounded-card bg-bubble-ai p-sm', className)}>
      <Skeleton width="92%" />
      <Skeleton width="76%" />
      <Skeleton width="54%" />
    </View>
  );
}

export function SkeletonList({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <View className={cx('w-full gap-sm', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} className="w-full gap-xs rounded-card border border-edge-subtle p-sm">
          <Skeleton width={90} height={10} />
          <Skeleton width="88%" />
        </View>
      ))}
    </View>
  );
}
