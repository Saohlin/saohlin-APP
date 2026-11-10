import { Stack } from 'expo-router';

import { RequireOnboarded } from '../../auth';

// Signed-in app. RequireOnboarded covers session, verification and onboarding.
export default function AppLayout() {
  return (
    <RequireOnboarded>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: 'transparent' } }}>
        <Stack.Screen name="(drawer)" />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      </Stack>
    </RequireOnboarded>
  );
}
