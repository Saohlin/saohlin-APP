import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useColorScheme as useNativeWindColorScheme } from 'nativewind';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { DEFAULT_SCHEME, LIGHT_ONLY_LAUNCH } from './config';
import {
  capsule,
  colors,
  gradients,
  mesh,
  type ColorScheme,
  type GradientSet,
  type MeshSpec,
  type Palette,
} from './tokens';
import { alpha, motion, radius, scrim, shadow, space, withAlpha, z } from './layout';
import { fonts, type } from './typography';

export type ThemePreference = 'light' | 'dark' | 'system';

export type Theme = {
  /** What is actually on screen right now. */
  scheme: ColorScheme;
  /** What the user asked for. 'system' follows the OS. */
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** True while the light-only launch lock is on. */
  locked: boolean;

  colors: Palette;
  gradients: GradientSet;
  mesh: MeshSpec;
  capsule: typeof capsule;
  type: typeof type;
  fonts: typeof fonts;
  space: typeof space;
  radius: typeof radius;
  shadow: ReturnType<typeof shadow>;
  motion: typeof motion;
  alpha: typeof alpha;
  z: typeof z;
  scrim: string;
  withAlpha: typeof withAlpha;
};

const ThemeContext = createContext<Theme | null>(null);

/**
 * Keeps the NativeWind colour scheme (CSS variables, `dark:` variants) and the
 * JS token object (Skia, gradients, status bar) in sync.
 */
export function ThemeProvider({
  children,
  preference: controlled,
}: {
  children: ReactNode;
  /** Optional override, e.g. from persisted settings. */
  preference?: ThemePreference;
}) {
  const system = useSystemColorScheme();
  const { colorScheme, setColorScheme } = useNativeWindColorScheme();

  const preference: ThemePreference = LIGHT_ONLY_LAUNCH
    ? DEFAULT_SCHEME
    : (controlled ?? (colorScheme as ThemePreference | undefined) ?? 'system');

  const systemScheme: ColorScheme = system === 'dark' ? 'dark' : 'light';

  const scheme: ColorScheme = LIGHT_ONLY_LAUNCH
    ? DEFAULT_SCHEME
    : preference === 'system'
      ? systemScheme
      : preference;

  useEffect(() => {
    setColorScheme(LIGHT_ONLY_LAUNCH ? DEFAULT_SCHEME : preference);
  }, [preference, setColorScheme]);

  const setPreference = useCallback(
    (p: ThemePreference) => {
      if (LIGHT_ONLY_LAUNCH) {
        if (__DEV__) {
          console.warn(
            '[theme] Ignoring setPreference: the first release is locked to light mode. ' +
              'Flip LIGHT_ONLY_LAUNCH in theme/config.ts to enable dark mode.',
          );
        }
        return;
      }
      setColorScheme(p);
    },
    [setColorScheme],
  );

  const value = useMemo<Theme>(
    () => ({
      scheme,
      preference,
      setPreference,
      locked: LIGHT_ONLY_LAUNCH,
      colors: colors[scheme],
      gradients: gradients[scheme],
      mesh: mesh[scheme],
      capsule,
      type,
      fonts,
      space,
      radius,
      shadow: shadow(scheme),
      motion,
      alpha,
      z,
      scrim: scrim(scheme),
      withAlpha,
    }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>.');
  return ctx;
}

/** Just the colours, for the common case. */
export function useColors(): Palette {
  return useTheme().colors;
}
