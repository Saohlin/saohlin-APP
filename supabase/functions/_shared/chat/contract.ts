// The chat function's contract, shared with the app (copied to lib/api/chatContract.ts).
//
// POST /functions/v1/chat   Authorization: Bearer <user JWT>   Accept: text/event-stream
// Body: ChatRequest. Response: Server-Sent Events, one JSON object per event.

export type InputMethod = "text" | "voice";
export type Origin = "chat" | "welcome" | "guide_draw" | "journal_share";

export interface ChatRequest {
  clientMsgId: string;            // uuid made on the phone; a retry reuses it
  conversationId: string | null;  // null starts a new conversation
  text: string;                   // 1..4000 characters (ignored when resuming)
  inputMethod: InputMethod;
  resumeMessageId: string | null; // after a purchase: answer the held message
  origin?: Origin;                // for a new conversation
  guideDrawId?: string | null;    // Guides module hand-off
}

export type ErrorCode =
  | "UNAUTHENTICATED" | "INVALID_INPUT" | "NOT_FOUND" | "RATE_LIMITED"
  | "AI_UNAVAILABLE" | "CREDIT_EXHAUSTED" | "MAINTENANCE";
export type LimitCode = "PAYWALL" | "DAILY_CAP" | "AI_PAUSED" | "RATE_LIMITED";

export interface CrisisResource { name: string; phone: string; hours?: string; audience?: string }

export type ChatEvent =
  | { event: "accepted"; data: { conversationId: string; userMessageId: string; trialRemaining: number | null; degraded: boolean } }
  | { event: "delta"; data: { text: string } }
  | { event: "crisis"; data: { resources: CrisisResource[] } }
  | { event: "done"; data: { assistantMessageId: string; mode: string } }
  | { event: "limit"; data: { code: LimitCode; message: string; retryAfterSeconds?: number; conversationId?: string; userMessageId?: string } }
  | { event: "error"; data: { code: ErrorCode; retryable: boolean } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = new Set(["clientMsgId", "conversationId", "text", "inputMethod", "resumeMessageId", "origin", "guideDrawId"]);
const ORIGINS = new Set(["chat", "welcome", "guide_draw", "journal_share"]);

export class InvalidInput extends Error {
  constructor(readonly field: string) {
    super("INVALID_INPUT");
  }
}

/** Strict validation: unknown fields are rejected; the user id never comes from the body. */
export function parseRequest(body: unknown, maxChars = 4000): ChatRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InvalidInput("body");
  const b = body as Record<string, unknown>;
  for (const k of Object.keys(b)) if (!FIELDS.has(k)) throw new InvalidInput(k);
  const uuidOrNull = (k: string) => {
    const v = b[k];
    if (v === undefined || v === null) return null;
    if (typeof v !== "string" || !UUID.test(v)) throw new InvalidInput(k);
    return v;
  };
  const clientMsgId = uuidOrNull("clientMsgId");
  if (!clientMsgId) throw new InvalidInput("clientMsgId");
  const resumeMessageId = uuidOrNull("resumeMessageId");
  const text = typeof b.text === "string" ? b.text : "";
  if (!resumeMessageId && (text.trim().length === 0 || [...text].length > maxChars)) throw new InvalidInput("text");
  const inputMethod = b.inputMethod ?? "text";
  if (inputMethod !== "text" && inputMethod !== "voice") throw new InvalidInput("inputMethod");
  const origin = b.origin ?? "chat";
  if (typeof origin !== "string" || !ORIGINS.has(origin)) throw new InvalidInput("origin");
  return {
    clientMsgId,
    conversationId: uuidOrNull("conversationId"),
    text,
    inputMethod,
    resumeMessageId,
    origin: origin as Origin,
    guideDrawId: uuidOrNull("guideDrawId"),
  };
}

export function sse(e: ChatEvent): string {
  return `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`;
}
