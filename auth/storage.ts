import * as SecureStore from 'expo-secure-store';

// Session is kept in the device keychain, never in plain AsyncStorage.
const TOKEN_KEY = 'saohlin.session.token';
const USER_KEY = 'saohlin.session.user';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function saveSession(token: string, userId: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token, OPTIONS);
  await SecureStore.setItemAsync(USER_KEY, userId, OPTIONS);
}

export async function readSession(): Promise<{ token: string; userId: string } | null> {
  const [token, userId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY, OPTIONS),
    SecureStore.getItemAsync(USER_KEY, OPTIONS),
  ]);
  return token && userId ? { token, userId } : null;
}

export async function clearSession() {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY, OPTIONS),
    SecureStore.deleteItemAsync(USER_KEY, OPTIONS),
  ]);
}
