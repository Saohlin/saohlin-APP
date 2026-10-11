/**
 * A feedback message being written survives leaving the screen, a call, or the
 * app being closed. Kept encrypted (lib/secureStorage), like a journal draft,
 * and removed once the message is sent or the field is emptied.
 */
import { secureStorage } from '../secureStorage';

const keyFor = (userId: string) => `feedback.draft.${userId}`;

export async function readFeedbackDraft(userId: string): Promise<string> {
  try {
    const raw = await secureStorage.getItem(keyFor(userId));
    const body = raw ? (JSON.parse(raw) as { body?: unknown }).body : null;
    return typeof body === 'string' ? body : '';
  } catch {
    return '';
  }
}

export async function writeFeedbackDraft(userId: string, body: string): Promise<void> {
  try {
    if (body.trim().length === 0) await secureStorage.removeItem(keyFor(userId));
    else await secureStorage.setItem(keyFor(userId), JSON.stringify({ body, savedAt: Date.now() }));
  } catch {
    // A draft that cannot be stored must never stop the user writing.
  }
}

export async function clearFeedbackDraft(userId: string): Promise<void> {
  try {
    await secureStorage.removeItem(keyFor(userId));
  } catch {
    // The next send or an emptied field clears it again.
  }
}
