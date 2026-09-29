/**
 * Talking to the chat Edge Function and the conversation RPCs.
 *
 * The function streams Server-Sent Events. `fetch` from expo/fetch exposes the
 * response body as a stream on iOS and Android (React Native's own fetch does
 * not), so no SSE polyfill is needed. The supabase client's fetch has a 10 s
 * timeout for ordinary calls and is not used for the stream.
 */
import { fetch as streamingFetch } from 'expo/fetch';

import type { ChatEvent, ChatRequest } from '../../supabase/functions/_shared/chat/contract';
import { createSseParser } from '../chat/sse';
import type { StoredMessage } from '../chat/reducer';
import { supabase } from '../supabase';

export type { ChatEvent, ChatRequest };

const url = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/** Everything runs in Frankfurt, next to the database. */
const REGION = 'eu-central-1';

/** HTTP-level failures, before any event arrived. */
export class ChatHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

async function accessToken(forceRefresh = false): Promise<string | null> {
  if (forceRefresh) {
    const { data } = await supabase.auth.refreshSession();
    return data.session?.access_token ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Sends one message and calls `onEvent` for every event, in order. Resolves
 * when the stream ends. Throws ChatHttpError for a rejected request and a
 * TypeError (from fetch) when the network is down.
 */
export async function streamChat(
  body: ChatRequest,
  onEvent: (e: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const call = async (token: string) =>
    streamingFetch(`${url}/functions/v1/chat`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: anonKey,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'x-region': REGION,
      },
      body: JSON.stringify(body),
      signal,
    });

  let token = await accessToken();
  if (!token) throw new ChatHttpError(401, 'UNAUTHENTICATED');
  let res = await call(token);
  if (res.status === 401) {
    // An expired access token: refresh once and resend the same message (same clientMsgId, so never counted twice).
    token = await accessToken(true);
    if (!token) throw new ChatHttpError(401, 'UNAUTHENTICATED');
    res = await call(token);
  }
  if (!res.ok || !res.body) {
    let code = 'AI_UNAVAILABLE';
    try {
      code = ((await res.json()) as { code?: string }).code ?? code;
    } catch {
      // not JSON
    }
    throw new ChatHttpError(res.status, code);
  }

  const parser = createSseParser((e) => onEvent(e as unknown as ChatEvent));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}

// ---------------------------------------------------------------- conversations

export type ConversationSummary = {
  id: string;
  title: string | null;
  origin: string;
  exchangeCount: number;
  startedAt: string;
  lastMessageAt: string;
};

export async function listConversations(page = 0): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('list_conversations', { p_page: page });
  if (error) throw error;
  return (data ?? []) as ConversationSummary[];
}

export async function getConversation(
  id: string,
  before?: string,
): Promise<{ conversation: ConversationSummary; messages: StoredMessage[]; hasMore: boolean }> {
  const { data, error } = await supabase.rpc('get_conversation', { p_id: id, p_before: before ?? null, p_limit: 50 });
  if (error) throw error;
  return data as { conversation: ConversationSummary; messages: StoredMessage[]; hasMore: boolean };
}

export async function renameConversation(id: string, title: string) {
  const { error } = await supabase.rpc('rename_conversation', { p_id: id, p_title: title });
  if (error) throw error;
}

export async function clearConversation(id: string) {
  const { error } = await supabase.rpc('clear_conversation', { p_id: id });
  if (error) throw error;
}

export async function restoreConversation(id: string) {
  const { error } = await supabase.rpc('restore_conversation', { p_id: id });
  if (error) throw error;
}

/** Crisis lines for the card, from public config (confirmed numbers only). */
export async function crisisResources() {
  const { data } = await supabase.from('app_config').select('value').eq('key', 'crisis.resources').maybeSingle();
  return ((data?.value as unknown) ?? []) as { name: string; phone: string; hours?: string; audience?: string }[];
}
