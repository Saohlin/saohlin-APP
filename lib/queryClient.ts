import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * The one TanStack Query client for server state. Queries refetch when the app
 * returns to the foreground (React Native has no window focus), so content
 * Claudia edits in the admin reaches users without a new build.
 *
 * The cache belongs to the signed-in user: SessionProvider clears it when the
 * session ends, so nothing carries over to the next account on the phone.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});

// Registered once, at module load: the app foreground counts as window focus.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => setFocused(state === 'active'));
    return () => sub.remove();
  });
}
