import { Stack } from 'expo-router';

import { RequireSessionOnly } from '../../auth';

// Onboarding order is enforced by session status, not navigation history,
// so deep links can't skip ahead.
export default function OnboardingLayout() {
  return (
    <RequireSessionOnly>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          gestureEnabled: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </RequireSessionOnly>
  );
}
