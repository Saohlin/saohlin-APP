import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
} from 'expo-router';

// Import individual weights; the package root pulls in all 18 Inter weights.
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Michroma_400Regular } from '@expo-google-fonts/michroma/400Regular';
// Alternative body fonts, loaded for comparison. Remove the unused ones once the choice is final.
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { DMSans_400Regular } from '@expo-google-fonts/dm-sans/400Regular';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans/500Medium';
import { DMSans_600SemiBold } from '@expo-google-fonts/dm-sans/600SemiBold';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { MeshBackdrop } from '../components/brand/MeshBackdrop';
import { SessionProvider, useSession } from '../auth';
import { I18nProvider } from '../i18n';
import { ThemeProvider, useTheme } from '../theme';

// Pulls in the compiled Tailwind classes and CSS variables.
import '../global.css';

/**
 * Keep the native splash up from module scope, before React mounts, so there's
 * no blank frame while fonts and the stored session load. `catch` because the
 * call rejects on reload when the splash is already gone.
 */
SplashScreen.preventAutoHideAsync().catch(() => {});

// `fade` is iOS-only; Android uses `duration`.
SplashScreen.setOptions({ duration: 320, fade: true });

// Provider order: theme and i18n outermost, then session, then the router,
// so guards can redirect as soon as the session resolves.
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Michroma_400Regular,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
  });

  // Wait for fonts (the native splash is still showing). If a font fails, carry on
  // with the system face rather than blocking.
  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <I18nProvider>
          <SessionProvider>
            <SplashGate />
            <Navigation />
          </SessionProvider>
        </I18nProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Hides the native splash once the stored session has been read, one frame
 * after the first real render, so returning users don't see a flash of sign-in.
 */
function SplashGate() {
  const { status } = useSession();

  useEffect(() => {
    if (status === 'restoring') return;
    const frame = requestAnimationFrame(() => {
      SplashScreen.hideAsync().catch(() => {});
    });
    return () => cancelAnimationFrame(frame);
  }, [status]);

  return null;
}

/**
 * The navigation theme's background must be transparent, otherwise the
 * navigator paints an opaque grey over the mesh backdrop.
 */
function Navigation() {
  const { colors, scheme } = useTheme();

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: 'transparent',
      card: 'transparent',
      text: colors.text,
      border: colors.borderSubtle,
      notification: colors.errorSolid,
    },
  };

  return (
    <NavigationThemeProvider value={navTheme}>
      <MeshBackdrop />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </NavigationThemeProvider>
  );
}
