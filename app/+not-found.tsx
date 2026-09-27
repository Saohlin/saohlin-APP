import { useRouter } from 'expo-router';

import { ErrorState, Screen } from '../components/ui';

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <ErrorState onRetry={() => router.replace('/')} />
    </Screen>
  );
}
