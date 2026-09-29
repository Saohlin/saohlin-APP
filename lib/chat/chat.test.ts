/**
 * The chat screen's logic without a device: the SSE parser and every state
 * transition of a message.
 *
 *   deno test --unstable-sloppy-imports lib/chat/
 */
import { deepStrictEqual as eq, ok } from 'node:assert';

import { createSseParser, type RawEvent } from './sse';
import { busy, initialState, reducer, type Action, type ChatState } from './reducer';

const run = (actions: Action[], s: ChatState = initialState) => actions.reduce(reducer, s);
const now = '2026-09-30T10:00:00.000Z';
const K = 'c1';
const ev = (e: any): Action => ({ type: 'event', e, clientMsgId: K, now });

Deno.test('SSE: events survive being split anywhere', () => {
  const out: RawEvent[] = [];
  const p = createSseParser((e) => out.push(e));
  const wire = 'event: accepted\ndata: {"conversationId":"x","userMessageId":"u","trialRemaining":4,"degraded":false}\n\n' +
    'event: delta\ndata: {"text":"Evo, rozumím. "}\n\nevent: done\ndata: {"assistantMessageId":"a","mode":"PROZKOUMANI"}\n\n';
  for (let i = 0; i < wire.length; i += 5) p.push(wire.slice(i, i + 5));
  p.end();
  eq(out.map((e) => e.event), ['accepted', 'delta', 'done']);
  eq((out[1].data as any).text, 'Evo, rozumím. ');
});

Deno.test('SSE: CRLF and a malformed event are handled, not shown', () => {
  const out: RawEvent[] = [];
  const p = createSseParser((e) => out.push(e));
  p.push('event: delta\r\ndata: {"text":"a"}\r\n\r\nevent: delta\ndata: {broken\n\nevent: delta\ndata: {"text":"b"}');
  p.end();
  eq(out.map((e) => (e.data as any).text), ['a', 'b']);
});

Deno.test('happy path: sending, accepted, thinking, streaming sentence by sentence, done', () => {
  let s = run([{ type: 'send', clientMsgId: K, text: 'Ahoj', now }]);
  eq([s.phase, s.messages[0].status, busy(s)], ['sending', 'sending', true]);
  s = run([ev({ event: 'accepted', data: { conversationId: 'conv', userMessageId: 'u1', trialRemaining: 4, degraded: false } })], s);
  eq([s.phase, s.conversationId, s.trialRemaining, s.messages[0].status, s.messages[0].id], ['thinking', 'conv', 4, 'sent', 'u1']);
  s = run([ev({ event: 'delta', data: { text: 'Evo, rozumím. ' } }), ev({ event: 'delta', data: { text: 'Co tě trápí?' } })], s);
  eq([s.phase, s.messages.length, s.messages[1].text, s.messages[1].status], ['streaming', 2, 'Evo, rozumím. Co tě trápí?', 'streaming']);
  s = run([ev({ event: 'done', data: { assistantMessageId: 'a1', mode: 'PROZKOUMANI' } })], s);
  eq([s.phase, s.inFlight, s.messages[1].status, s.messages[1].id, busy(s)], ['idle', null, 'done', 'a1', false]);
});

Deno.test('our failure: the bubble stays, marked failed; retry reuses the clientMsgId', () => {
  let s = run([
    { type: 'send', clientMsgId: K, text: 'Ahoj', now },
    ev({ event: 'accepted', data: { conversationId: 'conv', userMessageId: 'u1', trialRemaining: 4, degraded: false } }),
    ev({ event: 'error', data: { code: 'AI_UNAVAILABLE', retryable: true } }),
  ]);
  eq([s.phase, s.messages.length, s.messages[0].status], ['idle', 1, 'failed']);
  eq(s.notice, { kind: 'error', code: 'AI_UNAVAILABLE', retryable: true });
  s = run([{ type: 'retry', clientMsgId: K }], s);
  eq([s.phase, s.messages[0].status, s.inFlight, s.notice], ['sending', 'sending', K, null]);
});

Deno.test('network drop mid-thinking: failed, and an empty reply bubble is removed', () => {
  const s = run([
    { type: 'send', clientMsgId: K, text: 'Ahoj', now },
    { type: 'network', clientMsgId: K },
  ]);
  eq([s.messages.length, s.messages[0].status, s.notice], [1, 'failed', { kind: 'error', code: 'NETWORK', retryable: true }]);
});

Deno.test('paywall: the message is held, not lost, and resumes in place', () => {
  let s = run([
    { type: 'send', clientMsgId: K, text: 'Ještě jedna otázka', now },
    ev({ event: 'limit', data: { code: 'PAYWALL', message: 'Její text', conversationId: 'conv', userMessageId: 'u9' } }),
  ]);
  eq([s.messages[0].status, s.messages[0].id, s.trialRemaining], ['held', 'u9', 0]);
  eq(s.notice, { kind: 'paywall', message: 'Její text', userMessageId: 'u9' });
  s = run([{ type: 'resume', userMessageId: 'u9' }], s);
  eq([s.phase, s.messages[0].status, s.inFlight, s.notice], ['sending', 'sending', K, null]);
});

Deno.test('daily cap and AI paused: not stored, so the text goes back into the composer', () => {
  for (const code of ['DAILY_CAP', 'AI_PAUSED'] as const) {
    const s = run([
      { type: 'send', clientMsgId: K, text: 'Moje zpráva', now },
      ev({ event: 'limit', data: { code, message: 'Její zpráva' } }),
    ]);
    eq(s.messages, []);
    eq(s.restoreDraft, 'Moje zpráva');
    eq(s.notice?.kind, code === 'DAILY_CAP' ? 'dailyCap' : 'aiPaused');
    eq(busy(s), false);
  }
});

Deno.test('rate limited: still in flight (the hook resends quietly)', () => {
  const s = run([
    { type: 'send', clientMsgId: K, text: 'a', now },
    ev({ event: 'limit', data: { code: 'RATE_LIMITED', message: '', retryAfterSeconds: 7 } }),
  ]);
  eq([s.phase, s.messages[0].status], ['sending', 'sending']);
  eq(s.notice, { kind: 'rateLimited', retryAfterSeconds: 7 });
});

Deno.test('crisis: the card data is kept for the screen', () => {
  const s = run([
    { type: 'send', clientMsgId: K, text: 'a', now },
    ev({ event: 'crisis', data: { resources: [{ name: 'Linka', phone: '000' }] } }),
  ]);
  eq(s.crisis, [{ name: 'Linka', phone: '000' }]);
});

Deno.test('a reopened conversation: stored statuses map to what the user can do', () => {
  const s = run([{
    type: 'loaded', conversationId: 'conv', hasMore: true,
    messages: [
      { id: 'm1', role: 'user', content: 'a', status: 'complete', mode: null, clientMsgId: 'k1', eventKind: null, createdAt: now },
      { id: 'm2', role: 'assistant', content: 'b', status: 'complete', mode: 'PROZKOUMANI', clientMsgId: null, eventKind: null, createdAt: now },
      { id: 'm3', role: 'user', content: 'c', status: 'pending', mode: null, clientMsgId: 'k3', eventKind: null, createdAt: now },
      { id: 'm4', role: 'user', content: 'd', status: 'awaiting_entitlement', mode: null, clientMsgId: 'k4', eventKind: null, createdAt: now },
      { id: 'm5', role: 'event', content: null, status: 'complete', mode: null, clientMsgId: null, eventKind: 'crisis_resources', createdAt: now },
    ],
  }]);
  eq(s.messages.map((m) => [m.key, m.status]), [['k1', 'sent'], ['m2', 'done'], ['k3', 'failed'], ['k4', 'held'], ['m5', 'done']]);
  ok(s.hasMore);
  // older page goes in front
  const s2 = run([{ type: 'loaded', conversationId: 'conv', hasMore: false, older: true, messages: [
    { id: 'm0', role: 'user', content: 'z', status: 'complete', mode: null, clientMsgId: 'k0', eventKind: null, createdAt: now },
  ] }], s);
  eq(s2.messages[0].key, 'k0');
  eq(s2.hasMore, false);
});

Deno.test('clearing leaves an undo notice; a new conversation keeps the trial count', () => {
  let s = run([
    { type: 'send', clientMsgId: K, text: 'a', now },
    ev({ event: 'accepted', data: { conversationId: 'conv', userMessageId: 'u', trialRemaining: 2, degraded: false } }),
    ev({ event: 'done', data: { assistantMessageId: 'x', mode: 'VEDENI' } }),
    { type: 'cleared', conversationId: 'conv' },
  ]);
  eq([s.messages, s.conversationId, s.trialRemaining], [[], null, 2]);
  eq(s.notice, { kind: 'cleared', conversationId: 'conv' });
  s = run([{ type: 'reset' }], s);
  eq([s.notice, s.trialRemaining], [null, 2]);
});
