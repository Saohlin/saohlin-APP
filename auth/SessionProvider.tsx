import type { Session as SupabaseSession } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  APP_VERSION,
  AUTH_CALLBACK_URL,
  CONSENT_NOTICE_VERSION,
  EMAIL_VERIFICATION_REQUIRED,
  PLATFORM,
  RESET_PASSWORD_URL,
} from '../lib/config';
import { supabase } from '../lib/supabase';
import type {
  AuthStatus,
  DeeperAnswers,
  EntitlementHint,
  Gender,
  OnboardingState,
  Profile,
  Session,
  UserSettings,
} from './types';
import type { ZodiacSign } from './zodiac';

type SessionValue = {
  status: AuthStatus;
  session: Session | null;
  profile: Profile | null;
  context: DeeperAnswers;
  onboarding: OnboardingState;
  entitlement: EntitlementHint;
  settings: UserSettings;
  /** Email awaiting confirmation after sign-up, if any. */
  pendingEmail: string | null;

  signIn: (email: string, password: string) => Promise<void>;
  /**
   * Registration name fields are merged into the staged profile. Resolves to
   * true when the email must be confirmed before the user can continue.
   */
  signUp: (
    email: string,
    password: string,
    name?: { firstName: string; lastName: string },
  ) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Confirms the pending email with the code from the confirmation email and signs in. */
  verifyEmailCode: (code: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  /** Forget the pending email, e.g. to register with a different one. */
  clearPendingEmail: () => Promise<void>;
  /** Completes a sign-in from an email link (confirmation or password reset). */
  exchangeCode: (code: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;

  grantConsent: () => Promise<void>;
  saveProfile: (p: Profile) => Promise<void>;
  /**
   * Saves the four onboarding answers. Kept separate from completeDeeper because
   * the welcome screen sits between the last answer and finishing onboarding.
   */
  saveDeeper: (answers: DeeperAnswers) => Promise<void>;
  completeDeeper: () => Promise<void>;
  /** Saves settings optimistically; reverts if the server rejects the change. */
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  /** Permanently deletes the account and all its data, then signs out. */
  deleteAccount: () => Promise<void>;
  /** Re-reads server state. */
  refresh: () => Promise<void>;
};

const EMPTY_ENTITLEMENT: EntitlementHint = {
  active: false,
  plan: null,
  trialRemaining: 5,
  trialTotal: 5,
};

const DEFAULT_SETTINGS: UserSettings = { notifications: true, voicePlayback: true, haptics: true };

const PENDING_EMAIL_KEY = 'saohlin.pendingEmail';

/** Shape returned by the `get_me` database function. */
type Me = {
  userId: string;
  email: string;
  emailVerified: boolean;
  profile: {
    displayName: string;
    vocative: string;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    gender: Gender;
    zodiac: ZodiacSign | null;
  };
  context: DeeperAnswers;
  onboarding: OnboardingState;
  entitlement: EntitlementHint;
  settings: UserSettings;
};

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Session and onboarding state. This mirrors server state for routing; the
 * backend enforces access.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [restoring, setRestoring] = useState(true);
  const [authSession, setAuthSession] = useState<SupabaseSession | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  /**
   * Profile and consent given before the account exists. Sent together with
   * sign-up so the consent timestamp is attached to the new user.
   */
  const pending = useRef<{ profile?: Profile; consent?: boolean }>({});
  const [stagedProfile, setStagedProfile] = useState<Profile | null>(null);
  const loadedFor = useRef<string | null>(null);

  const loadMe = useCallback(async () => {
    const { data, error } = await supabase.rpc('get_me');
    if (error) throw error;
    setMe((data as Me | null) ?? null);
  }, []);

  // Restore on cold start and follow auth changes. The splash stays up until
  // the stored session (and the user's state, if signed in) has loaded.
  useEffect(() => {
    let active = true;

    const apply = async (next: SupabaseSession | null) => {
      if (!active) return;
      setAuthSession(next);
      if (!next) {
        loadedFor.current = null;
        setMe(null);
        return;
      }
      if (loadedFor.current === next.user.id) return;
      loadedFor.current = next.user.id;
      try {
        await loadMe();
      } catch {
        // A session the server rejects is cleared rather than left to fail later.
        loadedFor.current = null;
        await supabase.auth.signOut({ scope: 'local' });
      }
    };

    (async () => {
      try {
        if (EMAIL_VERIFICATION_REQUIRED) {
          const stored = await AsyncStorage.getItem(PENDING_EMAIL_KEY).catch(() => null);
          if (active) setPendingEmail(stored);
        } else {
          await AsyncStorage.removeItem(PENDING_EMAIL_KEY).catch(() => {});
        }
        const { data } = await supabase.auth.getSession();
        await apply(data.session);
      } finally {
        if (active) setRestoring(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      // Defer: calling Supabase inside this callback can deadlock the client.
      setTimeout(() => void apply(next), 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMe]);

  const rememberPendingEmail = useCallback(async (email: string | null) => {
    setPendingEmail(email);
    if (email) await AsyncStorage.setItem(PENDING_EMAIL_KEY, email).catch(() => {});
    else await AsyncStorage.removeItem(PENDING_EMAIL_KEY).catch(() => {});
  }, []);

  const status: AuthStatus = useMemo(() => {
    if (restoring) return 'restoring';
    if (!authSession) return EMAIL_VERIFICATION_REQUIRED && pendingEmail ? 'needsVerification' : 'guest';
    if (EMAIL_VERIFICATION_REQUIRED && !authSession.user.email_confirmed_at) return 'needsVerification';
    if (!me) return 'restoring';
    if (!me.onboarding.profileCompletedAt) return 'needsProfile';
    if (!me.onboarding.deeperCompletedAt) return 'needsDeeper';
    return 'ready';
  }, [restoring, authSession, pendingEmail, me]);

  const session: Session | null = useMemo(
    () =>
      authSession
        ? {
            userId: authSession.user.id,
            accessToken: authSession.access_token,
            email: authSession.user.email ?? '',
            emailVerified: !!authSession.user.email_confirmed_at,
          }
        : null,
    [authSession],
  );

  const profile: Profile | null = useMemo(() => {
    if (me) {
      return {
        displayName: me.profile.displayName,
        vocative: me.profile.vocative,
        firstName: me.profile.firstName ?? undefined,
        lastName: me.profile.lastName ?? undefined,
        dateOfBirth: me.profile.dateOfBirth ?? undefined,
        gender: me.profile.gender,
        zodiac: me.profile.zodiac ?? undefined,
      };
    }
    return stagedProfile;
  }, [me, stagedProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        // Unconfirmed accounts go back to the verification screen.
        if (error.code === 'email_not_confirmed') await rememberPendingEmail(email.trim());
        throw error;
      }
      await rememberPendingEmail(null);
      // No navigation here: the guards route from the new status.
    },
    [rememberPendingEmail],
  );

  const signUp = useCallback(
    async (email: string, password: string, name?: { firstName: string; lastName: string }) => {
      // Registration names are kept separate from the display name.
      const staged = pending.current.profile;
      const profileData = staged
        ? { ...staged, ...name }
        : name
          ? { displayName: name.firstName, vocative: name.firstName, ...name }
          : undefined;

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: AUTH_CALLBACK_URL,
          data: {
            profile: profileData && {
              displayName: profileData.displayName,
              vocative: profileData.vocative,
              firstName: profileData.firstName,
              lastName: profileData.lastName,
              dateOfBirth: profileData.dateOfBirth,
              gender: profileData.gender,
            },
            consent: {
              accepted: !!pending.current.consent,
              noticeVersion: CONSENT_NOTICE_VERSION,
              appVersion: APP_VERSION,
              platform: PLATFORM,
            },
          },
        },
      });
      if (error) throw error;
      // An address that already has a confirmed account comes back as a user
      // with no identities, and the server sends no email. Without this check
      // the verify screen would wait for a code that never arrives.
      if (!data.session && data.user && data.user.identities?.length === 0) {
        throw new Error('EMAIL_ALREADY_REGISTERED');
      }
      pending.current = {};
      setStagedProfile(null);
      // With email confirmation switched off the user is signed in straight
      // away and the guards continue to onboarding.
      if (data.session) return false;
      await rememberPendingEmail(email.trim());
      return true;
    },
    [rememberPendingEmail],
  );

  const signOut = useCallback(async () => {
    pending.current = {};
    setStagedProfile(null);
    await rememberPendingEmail(null);
    await supabase.auth.signOut({ scope: 'local' });
  }, [rememberPendingEmail]);

  const resendVerification = useCallback(async () => {
    if (!pendingEmail) return;
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: pendingEmail,
      options: { emailRedirectTo: AUTH_CALLBACK_URL },
    });
    if (error) throw error;
  }, [pendingEmail]);

  const verifyEmailCode = useCallback(
    async (code: string) => {
      const email = pendingEmail ?? authSession?.user.email;
      if (!email) throw new Error('No email is waiting for confirmation.');
      const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw error;
      // The new session arrives through onAuthStateChange; the guards route on.
      await rememberPendingEmail(null);
    },
    [pendingEmail, authSession, rememberPendingEmail],
  );

  const clearPendingEmail = useCallback(() => rememberPendingEmail(null), [rememberPendingEmail]);

  const exchangeCode = useCallback(
    async (code: string) => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) throw error;
      await rememberPendingEmail(null);
    },
    [rememberPendingEmail],
  );

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: RESET_PASSWORD_URL,
    });
    if (error) throw error;
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    // Sign out every other device once the password changes.
    await supabase.auth.signOut({ scope: 'others' });
  }, []);

  const grantConsent = useCallback(async () => {
    // Before registration, consent is staged and sent with sign-up.
    if (!authSession) {
      pending.current.consent = true;
      return;
    }
    const { data, error } = await supabase.rpc('grant_consent', {
      p_kinds: ['terms', 'privacy', 'ai_processing', 'special_category'],
      p_notice_version: CONSENT_NOTICE_VERSION,
      p_platform: PLATFORM,
      p_app_version: APP_VERSION,
    });
    if (error) throw error;
    setMe(data as Me);
  }, [authSession]);

  const saveProfile = useCallback(
    async (p: Profile) => {
      if (!authSession) {
        pending.current.profile = p;
        setStagedProfile(p);
        return;
      }
      const { data, error } = await supabase.rpc('update_profile', {
        p_profile: {
          displayName: p.displayName,
          vocative: p.vocative,
          ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}),
          ...(p.gender ? { gender: p.gender } : {}),
        },
      });
      if (error) throw error;
      setMe(data as Me);
    },
    [authSession],
  );

  const saveDeeper = useCallback(async (answers: DeeperAnswers) => {
    const { error } = await supabase.rpc('save_context', {
      p_work: answers.work ?? null,
      p_situation: answers.situation ?? null,
      p_blocking: answers.blocking ?? null,
      p_visions: answers.visions ?? null,
    });
    if (error) throw error;
    setMe((m) => (m ? { ...m, context: answers } : m));
  }, []);

  const completeDeeper = useCallback(async () => {
    const { data, error } = await supabase.rpc('complete_onboarding', { p_step: 'deeper' });
    if (error) throw error;
    setMe(data as Me);
  }, []);

  const updateSettings = useCallback(async (patch: Partial<UserSettings>) => {
    let previous: UserSettings | undefined;
    setMe((m) => {
      if (!m) return m;
      previous = m.settings;
      return { ...m, settings: { ...m.settings, ...patch } };
    });
    const row: Record<string, boolean> = {};
    if (patch.notifications !== undefined) row.notifications = patch.notifications;
    if (patch.voicePlayback !== undefined) row.voice_playback = patch.voicePlayback;
    if (patch.haptics !== undefined) row.haptics = patch.haptics;
    const userId = authSession?.user.id;
    if (!userId) return;
    const { error } = await supabase.from('user_settings').update(row).eq('user_id', userId);
    if (error) {
      setMe((m) => (m && previous ? { ...m, settings: previous } : m));
      throw error;
    }
  }, [authSession]);

  const deleteAccount = useCallback(async () => {
    const { error } = await supabase.rpc('delete_my_account');
    if (error) throw error;
    pending.current = {};
    setStagedProfile(null);
    await rememberPendingEmail(null);
    // The user no longer exists, so only the local session needs clearing.
    await supabase.auth.signOut({ scope: 'local' });
  }, [rememberPendingEmail]);

  const refresh = useCallback(async () => {
    if (authSession) await loadMe();
  }, [authSession, loadMe]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      session,
      profile,
      context: me?.context ?? {},
      onboarding: me?.onboarding ?? {},
      entitlement: me?.entitlement ?? EMPTY_ENTITLEMENT,
      settings: me?.settings ?? DEFAULT_SETTINGS,
      pendingEmail,
      signIn,
      signUp,
      signOut,
      verifyEmailCode,
      resendVerification,
      clearPendingEmail,
      exchangeCode,
      requestPasswordReset,
      updatePassword,
      grantConsent,
      saveProfile,
      saveDeeper,
      completeDeeper,
      updateSettings,
      deleteAccount,
      refresh,
    }),
    [
      status, session, profile, me, pendingEmail, signIn, signUp, signOut, verifyEmailCode, resendVerification,
      clearPendingEmail, exchangeCode, requestPasswordReset, updatePassword, grantConsent,
      saveProfile, saveDeeper, completeDeeper, updateSettings, deleteAccount, refresh,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.');
  return ctx;
}
