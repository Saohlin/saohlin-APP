/**
 * Chat screen state. One user message moves through
 *   sending -> sent (accepted) -> [thinking -> streaming] -> done
 * with side exits: failed (retry with the same clientMsgId, free), held
 * (paywall; answered after purchase), and removed (daily cap, AI paused: the
 * server did not store it, so the text goes back into the composer).
 *
 * Pure, so it is tested without a device (lib/chat/chat.test.ts).
 */
import type { ChatEvent, CrisisResource, ErrorCode } from '../../supabase/functions/_shared/chat/contract';

export type Role = 'user' | 'assistant' | 'event';
export type UiStatus = 'sending' | 'sent' | 'failed' | 'held' | 'streaming' | 'done';

export type UiMessage = {
  /** Stable React key: the clientMsgId for the user's own messages, the id otherwise. */
  key: string;
  id?: string;
  role: Role;
  text: string;
  status: UiStatus;
  clientMsgId?: string;
  mode?: string | null;
  eventKind?: string | null;
  createdAt: string;
};

export type Phase = 'idle' | 'sending' | 'thinking' | 'streaming';

export type Notice =
  | { kind: 'paywall'; message: string; userMessageId: string }
  | { kind: 'dailyCap'; message: string }
  | { kind: 'aiPaused'; message: string }
  | { kind: 'rateLimited'; retryAfterSeconds: number }
  | { kind: 'error'; code: ErrorCode | 'NETWORK'; retryable: boolean }
  | { kind: 'cleared'; conversationId: string };

export type ChatState = {
  conversationId: string | null;
  messages: UiMessage[];
  phase: Phase;
  /** The user message in flight, if any. */
  inFlight: string | null;
  notice: Notice | null;
  trialRemaining: number | null;
  crisis: CrisisResource[] | null;
  hasMore: boolean;
  loading: boolean;
  /** Text handed back to the composer after a limit the server did not store. */
  restoreDraft: string | null;
};

export const initialState: ChatState = {
  conversationId: null,
  messages: [],
  phase: 'idle',
  inFlight: null,
  notice: null,
  trialRemaining: null,
  crisis: null,
  hasMore: false,
  loading: false,
  restoreDraft: null,
};

/** A message as get_conversation returns it. */
export type StoredMessage = {
  id: string;
  role: Role;
  content: string | null;
  status: 'pending' | 'complete' | 'failed' | 'awaiting_entitlement' | 'blocked';
  mode: string | null;
  clientMsgId: string | null;
  eventKind: string | null;
  createdAt: string;
};

export type Action =
  | { type: 'reset' }
  | { type: 'loading' }
  | { type: 'loaded'; conversationId: string; messages: StoredMessage[]; hasMore: boolean; older?: boolean }
  | { type: 'send'; clientMsgId: string; text: string; now: string }
  | { type: 'retry'; clientMsgId: string }
  | { type: 'resume'; userMessageId: string }
  | { type: 'event'; e: ChatEvent; clientMsgId: string; now: string }
  | { type: 'network'; clientMsgId: string }
  | { type: 'cleared'; conversationId: string }
  | { type: 'dismissNotice' }
  | { type: 'draftRestored' };

function fromStored(m: StoredMessage): UiMessage {
  const userStatus: Record<StoredMessage['status'], UiStatus> = {
    complete: 'sent',
    // A pending message after a reload was interrupted; retrying regenerates it for free.
    pending: 'failed',
    failed: 'failed',
    awaiting_entitlement: 'held',
    blocked: 'failed',
  };
  return {
    key: m.clientMsgId ?? m.id,
    id: m.id,
    role: m.role,
    text: m.content ?? '',
    status: m.role === 'user' ? userStatus[m.status] : 'done',
    clientMsgId: m.clientMsgId ?? undefined,
    mode: m.mode,
    eventKind: m.eventKind,
    createdAt: m.createdAt,
  };
}

const update = (msgs: UiMessage[], key: string, patch: Partial<UiMessage>) =>
  msgs.map((m) => (m.key === key ? { ...m, ...patch } : m));

export function reducer(s: ChatState, a: Action): ChatState {
  switch (a.type) {
    case 'reset':
      return { ...initialState, trialRemaining: s.trialRemaining };
    case 'loading':
      return { ...s, loading: true };
    case 'loaded': {
      const page = a.messages.map(fromStored);
      return {
        ...s,
        loading: false,
        conversationId: a.conversationId,
        messages: a.older ? [...page, ...s.messages] : page,
        hasMore: a.hasMore,
      };
    }
    case 'send':
      return {
        ...s,
        phase: 'sending',
        inFlight: a.clientMsgId,
        notice: null,
        crisis: null,
        messages: [
          ...s.messages,
          { key: a.clientMsgId, role: 'user', text: a.text, status: 'sending', clientMsgId: a.clientMsgId, createdAt: a.now },
        ],
      };
    case 'retry':
      return {
        ...s,
        phase: 'sending',
        inFlight: a.clientMsgId,
        notice: null,
        messages: update(s.messages, a.clientMsgId, { status: 'sending' }),
      };
    case 'resume': {
      const held = s.messages.find((m) => m.id === a.userMessageId);
      return {
        ...s,
        phase: 'sending',
        inFlight: held?.key ?? null,
        notice: null,
        messages: held ? update(s.messages, held.key, { status: 'sending' }) : s.messages,
      };
    }
    case 'network':
      return {
        ...s,
        phase: 'idle',
        inFlight: null,
        notice: { kind: 'error', code: 'NETWORK', retryable: true },
        messages: dropEmptyReply(update(s.messages, a.clientMsgId, { status: 'failed' })),
      };
    case 'cleared':
      return { ...initialState, trialRemaining: s.trialRemaining, notice: { kind: 'cleared', conversationId: a.conversationId } };
    case 'dismissNotice':
      return { ...s, notice: null };
    case 'draftRestored':
      return { ...s, restoreDraft: null };
    case 'event':
      return onEvent(s, a.e, a.clientMsgId, a.now);
  }
}

function dropEmptyReply(msgs: UiMessage[]): UiMessage[] {
  const last = msgs[msgs.length - 1];
  return last && last.role === 'assistant' && last.status === 'streaming' && !last.text ? msgs.slice(0, -1) : msgs;
}

function onEvent(s: ChatState, e: ChatEvent, key: string, now: string): ChatState {
  switch (e.event) {
    case 'accepted':
      return {
        ...s,
        phase: 'thinking',
        conversationId: e.data.conversationId,
        trialRemaining: e.data.trialRemaining,
        messages: update(s.messages, key, { status: 'sent', id: e.data.userMessageId }),
      };
    case 'delta': {
      const last = s.messages[s.messages.length - 1];
      if (last && last.role === 'assistant' && last.status === 'streaming') {
        return { ...s, phase: 'streaming', messages: update(s.messages, last.key, { text: last.text + e.data.text }) };
      }
      return {
        ...s,
        phase: 'streaming',
        messages: [...s.messages, { key: `reply:${key}`, role: 'assistant', text: e.data.text, status: 'streaming', createdAt: now }],
      };
    }
    case 'crisis':
      return { ...s, crisis: e.data.resources };
    case 'done': {
      const msgs = s.messages.map((m) =>
        m.key === `reply:${key}` ? { ...m, status: 'done' as const, id: e.data.assistantMessageId, mode: e.data.mode } : m,
      );
      return { ...s, phase: 'idle', inFlight: null, messages: msgs };
    }
    case 'limit': {
      const base = { ...s, phase: 'idle' as const, inFlight: null };
      switch (e.data.code) {
        case 'PAYWALL':
          return {
            ...base,
            conversationId: e.data.conversationId ?? s.conversationId,
            trialRemaining: 0,
            notice: { kind: 'paywall', message: e.data.message, userMessageId: e.data.userMessageId ?? '' },
            messages: update(s.messages, key, { status: 'held', id: e.data.userMessageId }),
          };
        case 'RATE_LIMITED':
          // Kept as sending; the hook resends after the delay.
          return { ...s, notice: { kind: 'rateLimited', retryAfterSeconds: e.data.retryAfterSeconds ?? 5 } };
        case 'DAILY_CAP':
        case 'AI_PAUSED': {
          const mine = s.messages.find((m) => m.key === key);
          return {
            ...base,
            restoreDraft: mine?.text ?? null,
            notice: e.data.code === 'DAILY_CAP'
              ? { kind: 'dailyCap', message: e.data.message }
              : { kind: 'aiPaused', message: e.data.message },
            messages: s.messages.filter((m) => m.key !== key),
          };
        }
      }
      return base;
    }
    case 'error':
      return {
        ...s,
        phase: 'idle',
        inFlight: null,
        notice: { kind: 'error', code: e.data.code, retryable: e.data.retryable },
        // Anything already shown is complete sentences and stays; an empty bubble goes.
        messages: dropEmptyReply(update(s.messages, key, { status: 'failed' })),
      };
  }
  return s;
}

/** True while a message is in flight: the drawer, menu and composer wait for done. */
export const busy = (s: ChatState) => s.phase !== 'idle';
