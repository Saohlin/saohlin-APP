import { Image, type ColorValue } from 'react-native';

import { useTheme } from '../../theme';

const WORDMARK = require('../../assets/brand/wordmark-saohlin.png');

/**
 * The SAOHLIN wordmark as an image (the logo is not a typeface), tinted through
 * the alpha channel so colour can be passed as a prop.
 */
export const WORDMARK_ASPECT = 5176 / 625;

export function Wordmark({
  width = 128,
  color,
}: {
  width?: number;
  color?: ColorValue;
}) {
  const { colors } = useTheme();
  return (
    <Image
      source={WORDMARK}
      accessibilityRole="image"
      accessibilityLabel="SAOHLIN"
      resizeMode="contain"
      style={{
        width,
        height: width / WORDMARK_ASPECT,
        tintColor: (color ?? colors.brandViolet) as ColorValue,
      }}
    />
  );
}
