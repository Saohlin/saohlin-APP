import { useState } from 'react';
import {
  Image,
  Pressable,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';

import { useTheme } from '../../theme';
import { Text } from './Text';
import { cx } from './cx';
import { useT } from '../../i18n';

/**
 * Guide card (23 guides plus the card back). Artwork is 1200 × 1800, so always
 * render at 2:3.
 */
export function GuideCard({
  source,
  name,
  index,
  faceDown,
  selected,
  onPress,
  width = 104,
  showName,
  className,
}: {
  source?: ImageSourcePropType;
  /** The card back, used for the draw on screen 24. */
  faceDown?: boolean;
  name?: string;
  index?: number;
  selected?: boolean;
  onPress?: () => void;
  width?: number;
  showName?: boolean;
  className?: string;
}) {
  const { shadow } = useTheme();
  const t = useT();
  const height = Math.round((width / 2) * 3);
  /** Corner radius scales with card width (about 8% of it) rather than using `rounded-card`. */
  const radius = Math.max(6, Math.round(width * 0.08));
  const label = faceDown ? t('cards.faceDown') : (name ?? t('cards.guide'));

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
      disabled={!onPress}
      onPress={onPress}
      className={cx('gap-xxs', onPress && 'active:opacity-85', className)}>
      <View
        style={[{ width, height, borderRadius: radius }, shadow.sm]}
        className={cx(
          'overflow-hidden border bg-brand-lavender',
          selected ? 'border-edge-focus' : 'border-edge',
        )}>
        {source ? (
          <Image source={source} resizeMode="cover" className="h-full w-full" accessibilityIgnoresInvertColors />
        ) : null}
      </View>
      {showName && name ? (
        <Text variant="micro" tone="tertiary" center style={{ width }}>
          {typeof index === 'number' ? `${String(index + 1).padStart(2, '0')} ` : ''}
          {name}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Face-down card grid, three per row. The column gap is fixed and the card
 * width is derived from the available width, so spacing stays exact on every
 * screen size.
 */
export const GUIDE_GRID_GAP = { column: 13, row: 15 } as const;

export function GuideDrawGrid({
  back,
  onPick,
  count = 9,
  columns = 3,
  className,
}: {
  back?: ImageSourcePropType;
  onPick?: (slot: number) => void;
  count?: number;
  columns?: number;
  className?: string;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.floor(e.nativeEvent.layout.width));
  const card = width
    ? Math.floor((width - GUIDE_GRID_GAP.column * (columns - 1)) / columns)
    : 0;

  return (
    <View
      onLayout={onLayout}
      className={cx('w-full flex-row flex-wrap', className)}
      style={{ columnGap: GUIDE_GRID_GAP.column, rowGap: GUIDE_GRID_GAP.row }}>
      {card
        ? Array.from({ length: count }, (_, i) => (
            <GuideCard key={i} faceDown source={back} width={card} onPress={() => onPick?.(i)} />
          ))
        : null}
    </View>
  );
}

/** The library on screen 26: all 23, scaled from the full artwork. */
export function GuideGrid({
  guides,
  onPick,
  cardWidth = 96,
  className,
}: {
  guides: Array<{ name: string; source?: ImageSourcePropType }>;
  onPick?: (index: number) => void;
  cardWidth?: number;
  className?: string;
}) {
  return (
    <View className={cx('w-full flex-row flex-wrap justify-between gap-sm', className)}>
      {guides.map((g, i) => (
        <GuideCard
          key={g.name}
          source={g.source}
          name={g.name}
          index={i}
          showName
          width={cardWidth}
          onPress={() => onPick?.(i)}
        />
      ))}
    </View>
  );
}
