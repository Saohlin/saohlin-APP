import 'react-native-get-random-values';

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as aesjs from 'aes-js';
import * as SecureStore from 'expo-secure-store';

/**
 * Session storage for supabase-js.
 *
 * The session is larger than SecureStore's ~2 KB limit, so it is encrypted
 * with AES-256 and kept in AsyncStorage, while the random key for each entry
 * lives in the keychain (this device only, available when unlocked).
 */
const KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const keyName = (key: string) => `saohlin.${key.replace(/[^A-Za-z0-9._-]/g, '_')}`;

async function encrypt(key: string, value: string) {
  const encryptionKey = crypto.getRandomValues(new Uint8Array(256 / 8));
  const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
  const encrypted = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
  await SecureStore.setItemAsync(keyName(key), aesjs.utils.hex.fromBytes(encryptionKey), KEYCHAIN_OPTIONS);
  return aesjs.utils.hex.fromBytes(encrypted);
}

async function decrypt(key: string, value: string) {
  const encryptionKeyHex = await SecureStore.getItemAsync(keyName(key), KEYCHAIN_OPTIONS);
  if (!encryptionKeyHex) return null;
  const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
}

export const secureStorage = {
  async getItem(key: string) {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return decrypt(key, encrypted);
  },
  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, await encrypt(key, value));
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(keyName(key), KEYCHAIN_OPTIONS);
  },
};
