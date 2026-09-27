import {
  Blur,
  Canvas,
  Circle,
  Fill,
  Group,
  LinearGradient,
  Paint,
  RadialGradient,
  Rect,
  vec,
} from '@shopify/react-native-skia';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { useTheme } from '../../theme';

/**
 * Background plate taken from frame 0 of the splash video (background only).
 * Kept as its own file so re-cutting the splash doesn't repaint every screen.
 * 1290 × 2796 matches a phone's aspect, so `cover` crops nothing in portrait.
 */
const BACKDROP = require('../../assets/brand/backdrop.png');

/** One soft colour spot: a radial blob fading to transparent, no hard edge. */
function MeshBlob({ cx, cy, r, color }: { cx: number; cy: number; r: number; color: string }) {
  return (
    <Circle cx={cx} cy={cy} r={r}>
      <RadialGradient c={vec(cx, cy)} r={r} colors={[color, `${color}00`]} />
    </Circle>
  );
}

/**
 * App background, mounted once at the root behind the navigator so it never
 * remounts and stays still while screens transition. Light theme paints the
 * image; dark theme draws soft blobs (no dark artwork yet).
 */
export function MeshBackdrop() {
  const { width, height } = useWindowDimensions();
  const { mesh, scheme } = useTheme();

  if (scheme !== 'dark') {
    return (
      // Base colour under the image so a slow decode never shows white or black.
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: mesh.base }]}
        pointerEvents="none">
{/* Explicit width and height: an Image lays out at its intrinsic size, so
   `absoluteFill` alone would render it at full pixel size. The drawer's copy
   also needs screen width inside a narrower panel. */}
        <Image
          source={BACKDROP}
          style={{ position: 'absolute', top: 0, left: 0, width, height }}
          resizeMode="cover"
          // Disable Android's default fade-in so the background doesn't appear to load twice.
          fadeDuration={0}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={{ width, height }}>
        <Fill color={mesh.base} />

        {/* Blurred as one layer so the blobs bleed into each other like a real
            mesh gradient, instead of reading as separate circular washes. */}
        <Group layer={<Paint><Blur blur={mesh.blur} /></Paint>}>
          {mesh.blobs.map((b, i) => (
            <MeshBlob
              key={i}
              cx={width * b.x}
              cy={height * b.y}
              r={width * b.r}
              color={b.color}
            />
          ))}
        </Group>

        <Rect x={0} y={0} width={width} height={height}>
          <LinearGradient
            start={vec(0, 0)}
            end={vec(width, height)}
            colors={[...mesh.sheen]}
          />
        </Rect>
      </Canvas>
    </View>
  );
}
