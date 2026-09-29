// A minimal OpenAI client: chat (JSON), chat stream, embeddings.
// fetch only, no SDK, so it runs in the Edge Function and in tests.
//
// "Credit exhausted" and "rate limited" are both HTTP 429. The error body's
// code tells them apart: insufficient_quota stops at once (no retry loop,
// admin alert); anything else is retryable.

export interface ChatMessage { role: string; content: string }
export interface Usage { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
export interface CallOpts { model: string; params?: Record<string, unknown>; maxTokens?: number; signal?: AbortSignal; json?: boolean }

export type ProviderErrorKind = "credit_exhausted" | "rate_limited" | "unavailable" | "auth" | "timeout" | "bad_request";

export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, readonly status: number, readonly code: string) {
    super(`openai ${kind} ${status} ${code}`);
  }
  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "unavailable" || this.kind === "timeout";
  }
}

export interface AI {
  chat(messages: ChatMessage[], opts: CallOpts): Promise<{ text: string; usage: Usage }>;
  chatStream(messages: ChatMessage[], opts: CallOpts): AsyncGenerator<{ delta?: string; usage?: Usage }>;
  embed(text: string, opts: { model: string; dims: number; signal?: AbortSignal }): Promise<{ vector: number[]; usage: Usage }>;
}

async function classify(res: Response): Promise<ProviderError> {
  let code = "";
  try {
    const j = await res.json();
    code = String(j?.error?.code ?? j?.error?.type ?? "");
  } catch {
    // body not JSON
  }
  const safe = code.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64) || String(res.status);
  if (res.status === 429) return new ProviderError(code === "insufficient_quota" ? "credit_exhausted" : "rate_limited", 429, safe);
  if (res.status === 401 || res.status === 403) return new ProviderError("auth", res.status, safe);
  if (res.status === 400 || res.status === 404 || res.status === 422) return new ProviderError("bad_request", res.status, safe);
  return new ProviderError("unavailable", res.status, safe);
}

export class OpenAI implements AI {
  constructor(private key: string, private base = "https://api.openai.com/v1") {}

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw new ProviderError("timeout", 0, "aborted");
      throw new ProviderError("unavailable", 0, (e as Error).name || "network");
    }
    if (!res.ok) throw await classify(res);
    return res;
  }

  async chat(messages: ChatMessage[], o: CallOpts) {
    const res = await this.post("/chat/completions", {
      model: o.model, messages, ...(o.params ?? {}),
      ...(o.maxTokens ? { max_completion_tokens: o.maxTokens } : {}),
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
    }, o.signal);
    const j = await res.json();
    return { text: String(j?.choices?.[0]?.message?.content ?? ""), usage: (j?.usage ?? {}) as Usage };
  }

  async *chatStream(messages: ChatMessage[], o: CallOpts) {
    const res = await this.post("/chat/completions", {
      model: o.model, messages, stream: true, stream_options: { include_usage: true }, ...(o.params ?? {}),
      ...(o.maxTokens ? { max_completion_tokens: o.maxTokens } : {}),
    }, o.signal);
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    try {
      for (;;) {
        let chunk: ReadableStreamReadResult<string>;
        try {
          chunk = await reader.read();
        } catch {
          throw new ProviderError(o.signal?.aborted ? "timeout" : "unavailable", 0, "stream");
        }
        if (chunk.done) break;
        buf += chunk.value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          const j = JSON.parse(payload);
          const delta = j?.choices?.[0]?.delta?.content;
          if (delta) yield { delta };
          if (j?.usage) yield { usage: j.usage as Usage };
        }
      }
    } finally {
      reader.releaseLock();
      try { await res.body?.cancel(); } catch { /* already closed */ }
    }
  }

  async embed(text: string, o: { model: string; dims: number; signal?: AbortSignal }) {
    const res = await this.post("/embeddings", { model: o.model, input: text, dimensions: o.dims }, o.signal);
    const j = await res.json();
    return { vector: j.data[0].embedding as number[], usage: (j?.usage ?? {}) as Usage };
  }
}
