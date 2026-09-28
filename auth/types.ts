import type { ZodiacSign } from './zodiac';

/** The signed-in user, as far as the client is allowed to know. */
export type Session = {
  userId: string;
  /** Kept in the device keychain, never in AsyncStorage and never in state that is logged. */
  accessToken: string;
  email: string;
  emailVerified: boolean;
};

/** Stored as a key; the label is rendered through i18n. */
export type Gender = 'female' | 'male' | 'other' | 'unspecified';

export type Profile = {
  /** What the user asked to be called. */
  displayName: string;
  /**
   * Czech vocative of displayName, derived at sign-up and stored so the AI
   * doesn't re-derive it each turn. Editable from the profile.
   */
  vocative: string;
  /** From the registration form. */
  firstName?: string;
  lastName?: string;
  /** ISO `YYYY-MM-DD`; displayed as `DD . MM . YYYY`. */
  dateOfBirth?: string;
  gender?: Gender;
  /** Derived from `dateOfBirth`, never asked. */
  zodiac?: ZodiacSign;
};

/**
 * Onboarding part 2: the four deeper questions. Sensitive data, collected only
 * after consent and account creation.
 */
export type DeeperAnswers = {
  work?: string;
  situation?: string;
  blocking?: string;
  visions?: string;
};

/**
 * Which gates the user has passed. Server-owned: the client renders from this,
 * it does not decide it.
 */
export type OnboardingState = {
  consentGrantedAt?: string;
  profileCompletedAt?: string;
  deeperCompletedAt?: string;
};

/**
 * Navigation hint only. Entitlement is verified on the server for every message;
 * nothing in the client may grant access based on this.
 */
export type EntitlementHint = {
  active: boolean;
  plan: 'founding' | 'public' | null;
  renewsAt?: string;
  billingProblem?: boolean;
  /** Free replies left, for display. The server counts before each AI call. */
  trialRemaining: number;
  trialTotal: number;
};

export type UserSettings = {
  notifications: boolean;
  voicePlayback: boolean;
  haptics: boolean;
};

export type AuthStatus =
  | 'restoring'
  | 'guest'
  | 'needsVerification'
  | 'needsConsent'
  | 'needsProfile'
  | 'needsDeeper'
  | 'ready';
