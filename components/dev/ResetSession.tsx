import { Pressable } from 'react-native';

import { useSession } from '../../auth';
import { Text } from '../ui/Text';
import { cx } from '../ui/cx';

/**
 * Dev-only "start again": clears the stored session so the first-run flow can
 * be replayed. The keychain survives reloads (and often reinstalls on iOS).
 * Off by default; flip RESET_VISIBLE locally when needed.
 */
export const RESET_VISIBLE = false;

export function ResetSession({ className }: { className?: string }) {
  const { signOut } = useSession();

  if (!RESET_VISIBLE) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Developer: clear session and start again"
      hitSlop={10}
      onPress={() => void signOut()}
      className={cx('self-center py-xs active:opacity-60', className)}>
      <Text variant="micro" tone="tertiary">
        · reset ·
      </Text>
    </Pressable>
  );
}
