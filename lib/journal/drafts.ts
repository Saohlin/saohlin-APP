/**
 * An unsaved entry survives a crash, a call, or the app being closed.
 *
 * The draft is written through lib/secureStorage (AES-256, key in the
 * keychain, this device only), never plain AsyncStorage: a journal entry is
 * the most private text in the app. It is removed as soon as the entry is
 * saved or the user discards it.
 *
 * `clientEntryId` is kept with a new entry's draft, so "save" after a restart
 * is still the same save: the server answers with the entry it already has
 * instead of making a second one.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { secureStorage } from '../secureStorage';

export type Draft = {
  body: string;
  /** New entries only: the id the first save attempt used. */
  clientEntryId?: string;
  /** New entries only: the day it was started for. */
  entryDate?: string | null;
  /** Edits only: the version the edit started from. */
  baseVersion?: number;
  savedAt: number;
};

const keyFor = (userId: string, entryId: string | null) => `journal.draft.${userId}.${entryId ?? 'new'}`;

export async function readDraft(userId: string, entryId: string | null): Promise<Draft | null> {
  try {
    const raw = await secureStorage.getItem(keyFor(userId, entryId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return typeof d?.body === 'string' && d.body.trim().length > 0 ? d : null;
  } catch {
    return null;
  }
}

export async function writeDraft(userId: string, entryId: string | null, draft: Omit<Draft, 'savedAt'>): Promise<void> {
  try {
    if (draft.body.trim().length === 0) {
      await secureStorage.removeItem(keyFor(userId, entryId));
      return;
    }
    await secureStorage.setItem(keyFor(userId, entryId), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // A draft that cannot be stored must never stop the user writing.
  }
}

export async function clearDraft(userId: string, entryId: string | null): Promise<void> {
  try {
    await secureStorage.removeItem(keyFor(userId, entryId));
  } catch {
    // Nothing to do: the next successful save clears it again.
  }
}

/** Account deletion: no journal text of that account may stay on the phone. */
export async function clearAllDrafts(userId: string): Promise<void> {
  try {
    const prefix = keyFor(userId, '');
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix) || k === keyFor(userId, null));
    await Promise.all(keys.map((k) => secureStorage.removeItem(k)));
  } catch {
    // The text is unreadable without the keychain key, and the key cannot outlive the app.
  }
}
