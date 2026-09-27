import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { clearSession, readSession, saveSession } from './storage';
import type {
  AuthStatus,
  DeeperAnswers,
  EntitlementHint,
  OnboardingState,
  Profile,
  Session,
} from './types';

type SessionValue = {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  context: DeeperAnswers;
  onboarding: OnboardingState;
  entitlement: EntitlementHint;

  signIn: (email: string, password: string) => Promise<void>;
  /** Registration name fields are merged into the staged profile. */
  signUp: (
    email: string,
    password: string,
    name?: { firstName: string; lastName: string },
  ) => Promise<void>;
  signOut: () => Promise<void>;
  grantConsent: () => Promise<void>;
  saveProfile: (p: Profile) => Promise<void>;
  /**
   * Saves the four onboarding answers. Kept separate from completeDeeper because
   * the welcome screen sits between the last answer and finishing onboarding.
   */
  saveDeeper: (answers: DeeperAnswers) => Promise<void>;
  completeDeeper: () => Promise<void>;
  /** Re-reads server state. Call after a purchase or a webhook-driven change. */
  refresh: () => Promise<void>;
};

const EMPTY_ENTITLEMENT: EntitlementHint = {
  active: false,
  plan: null,
  trialRemaining: 5,
  trialTotal: 5,
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Session and onboarding state. This mirrors server state for routing; the
 * backend enforces access. Network calls are stubbed (marked TODO) until the
 * backend is connected.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [restoring, setRestoring] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState>({});
  const [context, setContext] = useState<DeeperAnswers>({});
  /**
   * Profile and consent given before the account exists. Sent together with
   * sign-up so the consent timestamp is attached to the new user.
   */
  const [pending, setPending] = useState<{ profile?: Profile; consentAt?: string }>({});
  const [entitlement, setEntitlement] = useState<EntitlementHint>(EMPTY_ENTITLEMENT);

  // Restore on cold start; the splash stays up until this resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await readSession();
        if (cancelled || !stored) return;
        // TODO: fetch the current user and hydrate profile, onboarding and entitlement.
        setSession({
          userId: stored.userId,
          accessToken: stored.token,
          email: '',
          emailVerified: true,
        });
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const status: AuthStatus = useMemo(() => {
    if (restoring) return 'restoring';
    if (!session) return 'guest';
    if (!session.emailVerified) return 'needsVerification';
    // Consent is given on the profile screen together with the profile.
    if (!onboarding.profileCompletedAt) return 'needsProfile';
    if (!onboarding.deeperCompletedAt) return 'needsDeeper';
    return 'ready';
  }, [restoring, session, onboarding]);

  const signIn = useCallback(async (email: string, _password: string) => {
    // TODO: sign in via backend
    const next: Session = { userId: 'dev-user', accessToken: 'dev-token', email, emailVerified: true };
    await saveSession(next.accessToken, next.userId);
    setSession(next);
  }, []);

  const signUp = useCallback(
    async (
      email: string,
      _password: string,
      name?: { firstName: string; lastName: string },
    ) => {
      // Registration names are kept separate from the display name.
      const staged: Profile | undefined = pending.profile
        ? { ...pending.profile, ...name }
        : name
          ? { displayName: name.firstName, vocative: name.firstName, ...name }
          : undefined;
      // TODO: sign up via backend, sending the staged profile and consent.
      const next: Session = { userId: 'dev-user', accessToken: 'dev-token', email, emailVerified: true };
      await saveSession(next.accessToken, next.userId);
      setSession(next);
      setProfile(staged ?? null);
      const now = new Date().toISOString();
      setOnboarding({
        consentGrantedAt: pending.consentAt,
        profileCompletedAt: staged ? now : undefined,
      });
      setPending({});
    },
    [pending],
  );

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
    setProfile(null);
    setContext({});
    setOnboarding({});
    setEntitlement(EMPTY_ENTITLEMENT);
  }, []);

  const grantConsent = useCallback(async () => {
    const at = new Date().toISOString();
    // Before registration, consent is staged and sent with sign-up.
    if (!session) {
      setPending((x) => ({ ...x, consentAt: at }));
      return;
    }
    // TODO: record consent on the server (server timestamp and notice version).
    setOnboarding((o) => ({ ...o, consentGrantedAt: at }));
  }, [session]);

  const saveProfile = useCallback(
    async (p: Profile) => {
      setProfile(p);
      if (!session) {
        setPending((x) => ({ ...x, profile: p }));
        return;
      }
      // TODO: update profile
      setOnboarding((o) => ({ ...o, profileCompletedAt: new Date().toISOString() }));
    },
    [session],
  );

  const saveDeeper = useCallback(async (answers: DeeperAnswers) => {
    // TODO: save onboarding answers
    setContext(answers);
  }, []);

  const completeDeeper = useCallback(async () => {
    // TODO: mark onboarding complete
    setOnboarding((o) => ({ ...o, deeperCompletedAt: new Date().toISOString() }));
  }, []);

  const refresh = useCallback(async () => {
    // TODO: GET /me
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      session,
      profile,
      context,
      onboarding,
      entitlement,
      signIn,
      signUp,
      signOut,
      grantConsent,
      saveProfile,
      saveDeeper,
      completeDeeper,
      refresh,
    }),
    [status, session, profile, context, onboarding, entitlement, signIn, signUp, signOut, grantConsent, saveProfile, saveDeeper, completeDeeper, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.');
  return ctx;
}
