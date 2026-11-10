import * as Haptics from 'expo-haptics';

/**
 * Every haptic in the app goes through here, so the Haptics setting can switch
 * all of them off in one place. Calling expo-haptics directly bypasses the
 * setting; don't.
 */
let enabled = true;

/** Kept in step with the user's setting by the session provider. */
export function setHapticsEnabled(on: boolean) {
  enabled = on;
}

const run = (fire: () => Promise<void>) => {
  if (!enabled) return;
  // Haptics are a nicety: a device without them must never surface an error.
  void fire().catch(() => {});
};

export const haptic = {
  /** A light tap, for ordinary button presses. */
  tap: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A heavier thump, for a moment that should land. */
  thump: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  /** The system's "done" pattern, for something that just succeeded. */
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
};
