import { Redirect, type Href } from 'expo-router';
import type { ReactNode } from 'react';

import { LoadingState } from '../components/ui';
import { useSession } from './SessionProvider';
import type { AuthStatus } from './types';

/** Where a given status belongs, if it is not where it is. */
const HOME_FOR: Record<AuthStatus, Href | null> = {
  restoring: null,
  guest: '/sign-in',
  needsVerification: '/verify-email',
  // Kept mapped for older server responses; consent is now given on the profile screen.
  needsConsent: '/profile-setup',
  needsProfile: '/profile-setup',
  needsDeeper: '/deeper',
  ready: '/chat',
};

/**
 * Requires a session. Guards handle navigation only; the server enforces access.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'restoring') return <LoadingState />;
  if (status === 'guest') return <Redirect href="/sign-in" />;
  if (status === 'needsVerification') return <Redirect href="/verify-email" />;
  return <>{children}</>;
}

/** Signed-in app. Also requires completed onboarding, so it can't be deep-linked past. */
export function RequireOnboarded({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'restoring') return <LoadingState />;
  const home = HOME_FOR[status];
  if (status !== 'ready' && home) return <Redirect href={home} />;
  return <>{children}</>;
}

/** The onboarding stack itself: signed in, but deliberately not yet finished. */
export function RequireSessionOnly({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'restoring') return <LoadingState />;
  if (status === 'guest') return <Redirect href="/sign-in" />;
  if (status === 'ready') return <Redirect href="/chat" />;
  return <>{children}</>;
}

/** Sign-in and sign-up: send an already-authenticated user onward. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === 'restoring') return <LoadingState />;
  if (status !== 'guest') {
    const home = HOME_FOR[status];
    if (home) return <Redirect href={home} />;
  }
  return <>{children}</>;
}

/**
 * Paywall route gate. Decides what to show, never what to allow: entitlement is
 * checked on the server for every message. Never use this to guard data or AI calls.
 */
export function RequirePaidRoute({ children }: { children: ReactNode }) {
  const { entitlement } = useSession();
  if (!entitlement.active && entitlement.trialRemaining <= 0) {
    return <Redirect href="/paywall" />;
  }
  return <>{children}</>;
}
