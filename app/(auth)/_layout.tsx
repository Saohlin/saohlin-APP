import { Stack } from 'expo-router';

import { RequireGuest } from '../../auth';

// Public auth routes. Signed-in users are redirected to where they belong.
export default function AuthLayout() {
  return (
    <RequireGuest>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </RequireGuest>
  );
}
