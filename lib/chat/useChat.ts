/**
 * The chat screen's state and actions. Sending is optimistic: the bubble shows
 * at once, the server's `accepted` confirms it. A failed send keeps the text
 * and retries with the same clientMsgId, which the server never counts twice.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';

import {
  ChatHttpError,
  clearConversation,
  getConversation,
  restoreConversation,
  streamChat,
} from '../api/chat';
import type { ChatEvent, ChatRequest } from '../api/chat';
import { busy, initialState, reducer, type ChatState } from './reducer';
import { uuidv4 } from './uuid';

const newId = () => uuidv4();
const nowIso = () => new Date().toISOString();

export function useChat(opts: { conversationId?: string | null; onPaywall?: () => void } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef<ChatState>(state);
  stateRef.current = state;
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  const load = useCallback(async (id: string) => {
    dispatch({ type: 'loading' });
    const page = await getConversation(id);
    dispatch({ type: 'loaded', conversationId: id, messages: page.messages, hasMore: page.hasMore });
  }, []);

  const loadOlder = useCallback(async () => {
    const s = stateRef.current;
    if (!s.conversationId || !s.hasMore || s.loading) return;
    dispatch({ type: 'loading' });
    const page = await getConversation(s.conversationId, s.messages[0]?.createdAt);
    dispatch({ type: 'loaded', conversationId: s.conversationId, messages: page.messages, hasMore: page.hasMore, older: true });
  }, []);

  useEffect(() => {
    if (opts.conversationId) void load(opts.conversationId).catch(() => dispatch({ type: 'reset' }));
    else dispatch({ type: 'reset' });
  }, [opts.conversationId, load]);

  /** Runs one request; `key` is the clientMsgId of the bubble it belongs to. */
  const run = useCallback(async (key: string, req: ChatRequest) => {
    const onEvent = (e: ChatEvent) => {
      if (!mounted.current) return;
      dispatch({ type: 'event', e, clientMsgId: key, now: nowIso() });
      if (e.event === 'limit' && e.data.code === 'RATE_LIMITED') {
        // Quiet retry after the given delay; same clientMsgId.
        retryTimer.current = setTimeout(() => void run(key, req), (e.data.retryAfterSeconds ?? 5) * 1000);
      }
      if (e.event === 'limit' && e.data.code === 'PAYWALL') opts.onPaywall?.();
    };
    try {
      await streamChat(req, onEvent);
      // A stream that ended without done or error (the connection dropped mid-reply).
      const s = stateRef.current;
      if (mounted.current && s.inFlight === key && s.phase !== 'idle') {
        dispatch({ type: 'network', clientMsgId: key });
      }
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ChatHttpError) {
        const code = e.code === 'MAINTENANCE' || e.code === 'INVALID_INPUT' || e.code === 'UNAUTHENTICATED' ? e.code : 'AI_UNAVAILABLE';
        dispatch({ type: 'event', e: { event: 'error', data: { code, retryable: code === 'AI_UNAVAILABLE' } }, clientMsgId: key, now: nowIso() });
      } else {
        dispatch({ type: 'network', clientMsgId: key });
      }
    }
  }, [opts]);

  const send = useCallback((text: string, inputMethod: 'text' | 'voice' = 'text') => {
    const s = stateRef.current;
    const trimmed = text.trim();
    if (!trimmed || busy(s)) return false;
    const clientMsgId = newId();
    dispatch({ type: 'send', clientMsgId, text: trimmed, now: nowIso() });
    void run(clientMsgId, {
      clientMsgId, conversationId: s.conversationId, text: trimmed, inputMethod, resumeMessageId: null, origin: 'chat',
    });
    return true;
  }, [run]);

  /** Resend a failed message: same clientMsgId, so our own failure costs nothing. */
  const retry = useCallback((clientMsgId: string) => {
    const s = stateRef.current;
    const m = s.messages.find((x) => x.key === clientMsgId);
    if (!m || busy(s)) return;
    dispatch({ type: 'retry', clientMsgId });
    void run(clientMsgId, {
      clientMsgId, conversationId: s.conversationId, text: m.text, inputMethod: 'text', resumeMessageId: null,
    });
  }, [run]);

  /** After a purchase: answer the held message in place. */
  const resume = useCallback((userMessageId: string) => {
    const s = stateRef.current;
    const m = s.messages.find((x) => x.id === userMessageId);
    if (!m || busy(s)) return;
    dispatch({ type: 'resume', userMessageId });
    void run(m.key, {
      clientMsgId: m.clientMsgId ?? newId(), conversationId: s.conversationId, text: '', inputMethod: 'text',
      resumeMessageId: userMessageId,
    });
  }, [run]);

  const startNew = useCallback(() => dispatch({ type: 'reset' }), []);

  const clear = useCallback(async () => {
    const id = stateRef.current.conversationId;
    if (!id) {
      dispatch({ type: 'reset' });
      return;
    }
    await clearConversation(id);
    dispatch({ type: 'cleared', conversationId: id });
  }, []);

  const undoClear = useCallback(async (id: string) => {
    await restoreConversation(id);
    await load(id);
  }, [load]);

  return {
    state,
    busy: busy(state),
    send,
    retry,
    resume,
    startNew,
    clear,
    undoClear,
    loadOlder,
    dismissNotice: () => dispatch({ type: 'dismissNotice' }),
    draftRestored: () => dispatch({ type: 'draftRestored' }),
  };
}
