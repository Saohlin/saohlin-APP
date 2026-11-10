// Logging without content (G6.2). The only way the chat function logs.
// Accepts ids, counts, durations and codes; strings are allowed only if they
// look like an id or a code, so message text cannot end up in the logs even
// by mistake.
type Safe = string | number | boolean | null | undefined;

const ID_OR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function log(event: string, fields: Record<string, Safe> = {}): void {
  const out: Record<string, Safe> = { event };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string" && !ID_OR_CODE.test(v)) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  // deno-lint-ignore no-console
  console.log(JSON.stringify(out));
}
