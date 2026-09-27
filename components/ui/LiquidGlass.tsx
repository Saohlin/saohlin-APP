import { Canvas, Group, Image as SkiaImage, rect, useImage } from '@shopify/react-native-skia';
import { StyleSheet } from 'react-native';

import { LiquidSurface } from './LiquidSurface';

/**
 * Primary CTA capsule, drawn from the supplied button artwork.
 * Rendered as three slices (two caps at their natural aspect and a stretched
 * middle) so the rounded ends don't distort at wider widths.
 */

const CAPSULE = require('../../assets/brand/button-glass.png');

export function GlassCapsule({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const image = useImage(CAPSULE);

  if (!width || !height) return null;

  // Painted fallback while the image loads.
  if (image == null) {
    return <LiquidSurface width={width} height={height} variant="iridescent" />;
  }

  const sw = image.width();
  const sh = image.height();
  const w = width;
  const h = height;

  // Caps are square-ish regions half the capsule's height at each end, drawn at
  // the uniform scale that makes the source height match the target height.
  const k = h / sh;
  const cap = h / 2;

  // Below this there is no straight middle to stretch, so the whole thing is
  // drawn at one scale and the caps simply meet.
  if (w <= h * 1.02) {
    return (
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <SkiaImage image={image} x={0} y={0} width={w} height={h} fit="fill" />
      </Canvas>
    );
  }

  // Map the source middle span onto the target middle span; both slices
  // resolve to the same pixel at the seams, so there's no visible join.
  const m = (w - h) / (sw - sh);
  const ox = cap - (sh / 2) * m;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* left cap */}
      <Group clip={rect(0, 0, cap, h)}>
        <SkiaImage image={image} x={0} y={0} width={sw * k} height={h} fit="fill" />
      </Group>

      {/* straight middle, stretched */}
      <Group clip={rect(cap, 0, w - h, h)}>
        <SkiaImage image={image} x={ox} y={0} width={sw * m} height={h} fit="fill" />
      </Group>

      {/* right cap */}
      <Group clip={rect(w - cap, 0, cap, h)}>
        <SkiaImage image={image} x={w - sw * k} y={0} width={sw * k} height={h} fit="fill" />
      </Group>
    </Canvas>
  );
}
