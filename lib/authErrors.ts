import { AuthError, isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import type { Dictionary, Path } from '../i18n';

type Key = Path<Dictionary>;

/**
 * Maps backend errors to user-facing string keys. Messages never reveal
 * whether an email is registered.
 */
export function authErrorKey(error: unknown): Key {
  if (isAuthRetryableFetchError(error)) return 'validation.networkFailed';
  if (error instanceof Error && error.name === 'AbortError') return 'validation.networkFailed';

  if (isAuthApiError(error) || error instanceof AuthError) {
    switch ((error as AuthError).code) {
      case 'invalid_credentials':
        return 'validation.passwordWrong';
      case 'weak_password':
        return 'validation.passwordWeak';
      case 'email_address_invalid':
        return 'validation.emailInvalid';
      case 'over_email_send_rate_limit':
      case 'over_request_rate_limit':
        return 'validation.rateLimited';
      case 'flow_state_expired':
      case 'flow_state_not_found':
      case 'otp_expired':
      case 'bad_code_verifier':
        return 'validation.linkExpired';
      case 'same_password':
        return 'validation.passwordSame';
    }
  }

  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('AGE_BELOW_MINIMUM')) return 'validation.ageMinimum';
  if (message.includes('INVALID_DATE_OF_BIRTH')) return 'validation.ageMinimum';
  if (message.includes('CONSENT_REQUIRED')) return 'validation.consentRequired';
  if (message.includes('Network request failed')) return 'validation.networkFailed';
  return 'validation.generic';
}

export function isEmailNotConfirmed(error: unknown) {
  return error instanceof AuthError && error.code === 'email_not_confirmed';
}

// Symbols the server accepts for the "symbol" requirement.
const SYMBOL = /[!@#$%^&*()_+\-=[\]{};':"|<>?,./`~\\]/;

/**
 * Client-side check matching the server rule: at least 8 characters with a
 * lowercase letter, an uppercase letter, a digit and a symbol.
 */
export function passwordMeetsPolicy(password: string) {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    SYMBOL.test(password)
  );
}

export function looksLikeEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
