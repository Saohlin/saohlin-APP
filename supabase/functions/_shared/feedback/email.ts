// The email Claudia gets for one feedback message (screen 48, G4.8).
// Pure: no network, no clock, so the wording and the escaping are testable.

export type FeedbackRow = {
  id: string;
  lease: string;
  body: string;
  category: string | null;
  appVersion: string | null;
  platform: string | null;
  osVersion: string | null;
  locale: string | null;
  createdAt: string;
  email: string | null;
  name: string | null;
};

export type Email = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  reply_to?: string;
};

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** One line, no control characters: a name must not be able to add a header or a second subject. */
const oneLine = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** A plausible address, and nothing that could carry a second one. */
const ADDRESS = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** When it was sent, as she reads a clock: Prague time. */
export function pragueTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("cs-CZ", {
    timeZone: "Europe/Prague",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function buildEmail(row: FeedbackRow, opts: { from: string; to: string }): Email {
  const name = oneLine(row.name ?? "", 60);
  const sender = row.email && ADDRESS.test(row.email) ? row.email : null;
  const device = [
    row.platform === "ios" ? "iOS" : row.platform === "android" ? "Android" : row.platform,
    row.osVersion,
  ].filter(Boolean).join(" ");
  const details = [
    pragueTime(row.createdAt),
    row.appVersion ? `verze ${oneLine(row.appVersion, 40)}` : "",
    oneLine(device, 60),
  ].filter(Boolean).join(" · ");
  const who = [name, sender].filter(Boolean).join(", ") || "neznámý odesílatel";
  const hint = sender ? "Odpovědí na tento email napíšeš přímo jí." : "";

  const text = [row.body, "", "--", `Od: ${who}`, details, hint].filter((l, i) => i < 3 || l).join("\n");
  const html = [
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.55;max-width:560px">`,
    `<p style="white-space:pre-wrap;margin:0 0 24px">${escape(row.body)}</p>`,
    `<p style="font-size:13px;line-height:1.5;opacity:.7;border-top:1px solid;padding-top:12px;margin:0">`,
    [`Od: ${escape(who)}`, escape(details), escape(hint)].filter(Boolean).join("<br>"),
    `</p></div>`,
  ].join("");

  return {
    from: opts.from,
    to: [opts.to],
    subject: name ? `Zpráva z aplikace: ${name}` : "Zpráva z aplikace SAOHLIN",
    text,
    html,
    ...(sender ? { reply_to: sender } : {}),
  };
}
