/**
 * Feedback ("Napiš mi"): one message from the user to Claudia. The server
 * stores it encrypted and emails it to her; the app only calls this function.
 *
 * Same contract as the journal: bad requests are thrown as `JournalError`
 * (offline, session, invalid, unknown); the daily limit is an ordinary answer.
 */
import { Platform } from 'react-native';

import { APP_VERSION, PLATFORM } from '../config';
import { supabase } from '../supabase';
import { JournalError, classify, type Limit } from './journal';

/** The server's ceiling (`feedback.max_chars`). */
export const MAX_FEEDBACK_CHARS = 5000;
/** The counter appears from here. */
export const FEEDBACK_COUNTER_FROM = 4500;

export type FeedbackResult = { kind: 'ok'; id: string; createdAt: string } | Limit;

/**
 * Sends a message. `clientId` is made on the phone and reused on a retry, so
 * a send whose answer was lost never reaches her twice.
 */
export async function sendFeedback(input: { clientId: string; body: string; locale?: string }): Promise<FeedbackResult> {
  let res: Awaited<ReturnType<typeof supabase.rpc>>;
  try {
    res = await supabase.rpc('send_feedback', {
      p_client_id: input.clientId,
      p_body: input.body,
      p_app_version: APP_VERSION,
      p_platform: PLATFORM,
      p_os_version: String(Platform.Version ?? ''),
      p_locale: input.locale ?? null,
    });
  } catch (e) {
    throw new JournalError(classify(e));
  }
  if (res.error) throw new JournalError(classify(res.error));
  return res.data as FeedbackResult;
}
