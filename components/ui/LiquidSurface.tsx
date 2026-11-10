import {
  Blur,
  Canvas,
  Group,
  LinearGradient,
  Paint,
  RadialGradient,
  RoundedRect,
  vec,
} from '@shopify/react-native-skia';
import { useState } from 'react';

import {
  CAUSTIC_STOPS,
  IRIDESCENT,
  RIM_STOPS,
  SHEEN_STOPS,
  SOFT,
  VIOLET,
  WALL_STOPS,
} from '../../theme/materials';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

/**
 * The SAOHLIN glass material for any shape (buttons, icon buttons, chips).
 *
 * - Edge bands are stroked rounded rects inset from the outline, so they follow
 *   the silhouette at any aspect ratio.
 * - Capsules get two cap highlights; squarer shapes (under ~1.6:1) get a single
 *   highlight top-left, since two would merge and blow out on a circle.
 * - `iridescent` is for the one primary action on a screen; `soft` is the
 *   lighter, translucent version for everything else.
 */
export type GlassVariant = 'iridescent' | 'soft' | 'violet';

/** Below this aspect ratio, one specular highlight rather than two caps. */
const TWO_CAP_ASPECT = 1.6;

export function LiquidSurface({
  width,
  height,
  radius,
  variant = 'iridescent',
}: {
  width: number;
  height: number;
  /** Omit for a pill: half the height. */
  radius?: number;
  variant?: GlassVariant;
}) {
  if (!width || !height) return null;

  const w = width;
  const h = height;
  const r = radius ?? h / 2;
  const c = variant === 'soft' ? SOFT : variant === 'violet' ? VIOLET : IRIDESCENT;

  // Bands scale with the short side so small controls get the same material.
  const unit = Math.min(w, h);
  const wall = unit * 0.062;
  const twoCap = w / h >= TWO_CAP_ASPECT;

  /** A shape-following band: a stroke centred between two insets. */
  const stroke = (from: number, to: number) => {
    const inset = ((from + to) / 2) * unit;
    return {
      x: inset,
      y: inset,
      width: w - 2 * inset,
      height: h - 2 * inset,
      r: Math.max(0, r - inset),
      strokeWidth: (to - from) * unit,
    };
  };

  const rim = stroke(0.006, 0.052);
  const caustic = stroke(0.055, 0.115);
  const inner = stroke(wall / unit - 0.008, wall / unit + 0.008);

  /**
   * Below 48 pt the violet bead drops its two inner strokes, which otherwise
   * resolve into a visible double ring at that size. Rim and contour stay.
   */
  const singleEdge = variant === 'violet' && unit < 48;

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* the glass wall, sitting under everything */}
      <RoundedRect x={0} y={0} width={w} height={h} r={r}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(w, 0)}
          colors={c.wall as unknown as string[]}
          positions={c.wallStops as unknown as number[]}
        />
      </RoundedRect>

      <RoundedRect x={0} y={0} width={w} height={h} r={r}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(w, 0)}
          colors={c.base as unknown as string[]}
          positions={c.baseStops as unknown as number[]}
        />
      </RoundedRect>

      {twoCap ? (
        <>
          <RoundedRect x={0} y={0} width={w} height={h} r={r} blendMode="screen">
            <RadialGradient
              c={vec(r * 0.95, h * 0.4)}
              r={r * 1.55}
              colors={c.specular as unknown as string[]}
              positions={[0, 0.3, 0.62, 1]}
            />
          </RoundedRect>
          <RoundedRect x={0} y={0} width={w} height={h} r={r} blendMode="screen">
            <RadialGradient
              c={vec(w - r * 0.95, h * 0.44)}
              r={r * 1.6}
              colors={c.bounce as unknown as string[]}
              positions={[0, 0.28, 0.6, 1]}
            />
          </RoundedRect>
        </>
      ) : (
        <>
          {/* Single highlight, up and to the left. */}
          <RoundedRect x={0} y={0} width={w} height={h} r={r} blendMode="screen">
            <RadialGradient
              c={vec(w * 0.34, h * 0.3)}
              r={unit * 0.82}
              colors={c.specular as unknown as string[]}
              positions={[0, 0.34, 0.68, 1]}
            />
          </RoundedRect>
          <RoundedRect x={0} y={0} width={w} height={h} r={r} blendMode="screen">
            <RadialGradient
              c={vec(w * 0.74, h * 0.78)}
              r={unit * 0.62}
              colors={c.bounce as unknown as string[]}
              positions={[0, 0.36, 0.7, 1]}
            />
          </RoundedRect>
        </>
      )}

      {/* broad top sheen — soft enough to stay a straight gradient */}
      <RoundedRect x={0} y={0} width={w} height={h} r={r} blendMode="screen">
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, h)}
          colors={c.sheen as unknown as string[]}
          positions={SHEEN_STOPS}
        />
      </RoundedRect>

      {/* outer rim highlight — a stroke, so it runs round the caps */}
      <RoundedRect {...rim} style="stroke" blendMode="screen">
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, h)}
          colors={c.rim as unknown as string[]}
          positions={RIM_STOPS}
        />
      </RoundedRect>

      {/* Blend mode is set on the layer paint, not the child: the layer renders
         offscreen, so a child blend would composite against the empty layer and
         paint a black ring. */}
      {singleEdge ? null : (
        <Group layer={<Paint blendMode="screen"><Blur blur={unit * 0.012} /></Paint>}>
          <RoundedRect {...caustic} style="stroke">
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, h)}
              colors={c.caustic as unknown as string[]}
              positions={CAUSTIC_STOPS}
            />
          </RoundedRect>
        </Group>
      )}

      {/* bottom inner wall — multiply */}
      <RoundedRect x={0} y={0} width={w} height={h} r={r} blendMode="multiply">
        <LinearGradient
          start={vec(0, 0)}
          end={vec(0, h)}
          colors={c.innerWall as unknown as string[]}
          positions={WALL_STOPS}
        />
      </RoundedRect>

      {/* Inner face of the wall; alpha ramps so it reads as refraction, not an outline. */}
      {singleEdge ? null : (
        <Group layer={<Paint><Blur blur={unit * 0.007} /></Paint>}>
          <RoundedRect {...inner} style="stroke">
            <LinearGradient
              start={vec(0, 0)}
              end={vec(w, 0)}
              colors={c.inside as unknown as string[]}
              positions={[0, 0.1, 0.5, 0.9, 1]}
            />
          </RoundedRect>
        </Group>
      )}

      {/* outer contour */}
      <RoundedRect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={h - 1}
        r={Math.max(0, r - 0.5)}
        style="stroke"
        strokeWidth={1}>
        <LinearGradient
          start={vec(0, 0)}
          end={vec(w, 0)}
          colors={c.contour as unknown as string[]}
          positions={[0, 0.5, 1]}
        />
      </RoundedRect>
    </Canvas>
  );
}

/** Self-measuring variant: put it as the first child of a relatively positioned Pressable. */
export function GlassFill({
  radius,
  variant = 'soft',
}: {
  radius?: number;
  variant?: GlassVariant;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.abs(width - size.w) > 0.5 || Math.abs(height - size.h) > 0.5) {
      setSize({ w: Math.round(width), h: Math.round(height) });
    }
  };

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      <LiquidSurface width={size.w} height={size.h} radius={radius} variant={variant} />
    </View>
  );
}
