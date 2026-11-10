import { Image, type ImageSource } from 'expo-image';
import { Pressable, View } from 'react-native';

import { cx } from '../../../components/ui';
import { useT } from '../../../i18n';
import { useTheme } from '../../../theme';

/** The face-down image, the same for every card. Bundled so it shows at once. */
export const CARD_BACK: ImageSource = require('../../../assets/cards/back.jpg');

/**
 * One card at 2:3: the artwork from `card-art`, or the card back. The lavender
 * box shows until the artwork arrives, then the image fades in. Images are kept
 * in memory and on disk (their URLs never change content).
 */
export function CardArt({
  uri,
  faceDown,
  name,
  width,
  onPress,
  disabled,
  glow,
  className,
}: {
  uri?: string | null;
  faceDown?: boolean;
  /** Read out for the artwork; a face-down card is announced as such. */
  name?: string;
  width: number;
  onPress?: () => void;
  disabled?: boolean;
  /** The soft glow around the artwork on the card screen. */
  glow?: boolean;
  className?: string;
}) {
  const { shadow } = useTheme();
  const t = useT();
  const height = Math.round((width / 2) * 3);
  /** Corner radius scales with the card (about 8% of its width). */
  const radius = Math.max(6, Math.round(width * 0.08));
  const label = faceDown ? t('cards.faceDown') : (name ?? '');
  const source = faceDown ? CARD_BACK : uri ? { uri } : null;

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'image'}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={!onPress || disabled}
      onPress={onPress}
      className={cx(onPress && 'active:opacity-85', className)}>
      <View
        style={[{ width, height, borderRadius: radius }, glow ? shadow.lg : shadow.sm]}
        className={cx('overflow-hidden border bg-brand-lavender', glow ? 'border-edge-subtle' : 'border-edge')}>
        {source ? (
          <Image
            source={source}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
            style={{ width: '100%', height: '100%' }}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
    </Pressable>
  );
}
