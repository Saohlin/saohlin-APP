import assert from "node:assert/strict";
const assertEquals = (a: unknown, b: unknown) => assert.deepEqual(a, b);
import { buildEmail, pragueTime, type FeedbackRow } from "./email.ts";

const row: FeedbackRow = {
  id: "a", lease: "b", body: "Ahoj Claudie,\n<b>karty</b> & výklady se mi líbí.", category: "general",
  appVersion: "1.0.0", platform: "ios", osVersion: "26.1", locale: "cs-CZ",
  createdAt: "2026-10-11T16:05:00Z", email: "eva@example.com", name: "Eva",
};
const opts = { from: "SAOHLIN <feedback@saohlin.com>", to: "info@saohlin.com" };

Deno.test("the email carries the text, the sender and the device", () => {
  const e = buildEmail(row, opts);
  assertEquals(e.to, ["info@saohlin.com"]);
  assertEquals(e.subject, "Zpráva z aplikace: Eva");
  assertEquals(e.reply_to, "eva@example.com");
  assert(e.text.startsWith(row.body));
  assert(e.text.includes("Od: Eva, eva@example.com"));
  assert(e.text.includes("verze 1.0.0 · iOS 26.1"));
});

Deno.test("the time is Prague time", () => {
  assertEquals(pragueTime("2026-10-11T16:05:00Z"), "11. 10. 2026 18:05");
  assertEquals(pragueTime("nonsense"), "");
});

Deno.test("the text is escaped in the HTML part", () => {
  const e = buildEmail(row, opts);
  assert(e.html.includes("&lt;b&gt;karty&lt;/b&gt; &amp; výklady"));
  assert(!e.html.includes("<b>"));
});

Deno.test("a name cannot add lines to the subject", () => {
  const e = buildEmail({ ...row, name: "Eva\r\nBcc: x@y.cz" }, opts);
  assert(!/[\r\n]/.test(e.subject));
});

Deno.test("no usable address: no reply-to, and the email is still sent", () => {
  for (const email of [null, "eva@example.com, x@y.cz", "not an address"]) {
    const e = buildEmail({ ...row, email, name: null }, opts);
    assertEquals(e.reply_to, undefined);
    assertEquals(e.subject, "Zpráva z aplikace SAOHLIN");
    assert(!e.text.includes("Odpovědí"));
  }
});
