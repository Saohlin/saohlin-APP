import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

/** Must match `consent.notice_version` in app_config. */
export const CONSENT_NOTICE_VERSION = '2026-10';

export const APP_VERSION = Constants.expoConfig?.version ?? '1.0.0';
export const PLATFORM = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

/**
 * Email verification after sign-up: the confirmation email carries a 6-digit
 * code that is typed into the verify screen. Needs "Confirm email" on in
 * Supabase and the Confirm signup template to contain `{{ .Token }}`.
 */
export const EMAIL_VERIFICATION_REQUIRED = true;

/** Must match `otp_length` in supabase/config.toml and the Supabase dashboard. */
export const EMAIL_CODE_LENGTH = 6;

/** Minimum age to register. Also enforced by the database. */
export const MIN_AGE = 15;

/** Deep links the auth emails redirect to. Also listed in the Supabase redirect allow-list. */
export const AUTH_CALLBACK_URL = Linking.createURL('/auth-callback');
export const RESET_PASSWORD_URL = Linking.createURL('/reset-password');
