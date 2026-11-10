import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import { secureStorage } from './secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. See .env.example.');
}

/** Requests that hang are aborted so the UI never waits indefinitely. */
const REQUEST_TIMEOUT_MS = 10_000;

const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const upstream = init?.signal;
  upstream?.addEventListener('abort', () => controller.abort());
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const supabase = createClient(url, anonKey, {
  auth: {
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: { fetch: fetchWithTimeout },
});

// Refresh tokens only while the app is in the foreground.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}
