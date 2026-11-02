import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLinks,
  capAttachments,
  buildTaskPrompt,
  parseRoutingBlock,
  parseMemoryItems,
  topicFolderPath,
  pdfParagraphsFor,
  subjectFor,
  oneOffTaskKey,
  agentIdFromOneOffKey,
  isOneOffTaskKey,
  domainForAgent,
  ONE_OFF_AGENT_IDS,
  MAX_LINKS,
  MAX_TOTAL_ATTACHMENT_CHARS,
} from "../src/lib/agent/oneOff/jobInput.ts";

test("every agent gets its own one-off task key, and the key maps back to the agent", () => {
  assert.deepEqual([...ONE_OFF_AGENT_IDS], ["rebeka", "dave", "john", "ron", "jennifer"]);
  for (const id of ONE_OFF_AGENT_IDS) {
    assert.equal(oneOffTaskKey(id), `${id}_one_off_task`);
    assert.equal(agentIdFromOneOffKey(oneOffTaskKey(id)), id);
    assert.equal(isOneOffTaskKey(oneOffTaskKey(id)), true);
  }
  assert.equal(agentIdFromOneOffKey("rebeka_weekly_research_round"), null);
  assert.equal(agentIdFromOneOffKey("stranger_one_off_task"), null);
  assert.equal(isOneOffTaskKey("dave_email_activity_ingestion"), false);
});

test("domainForAgent keeps Ron and Jennifer in the CRM domain, the rest in MRV", () => {
  assert.equal(domainForAgent("rebeka"), "mrv");
  assert.equal(domainForAgent("dave"), "mrv");
  assert.equal(domainForAgent("john"), "mrv");
  assert.equal(domainForAgent("ron"), "crm");
  assert.equal(domainForAgent("jennifer"), "crm");
});

test("normalizeLinks keeps only http(s), dedupes, trims, caps the count", () => {
  const out = normalizeLinks([
    " https://verra.org/a ",
    "https://verra.org/a",
    "ftp://x.org/file",
    "javascript:alert(1)",
    "not a url",
    "http://example.com/b",
  ]);
  assert.deepEqual(out.links, ["https://verra.org/a", "http://example.com/b"]);
  assert.equal(out.rejected.length, 3);
  const many = normalizeLinks(Array.from({ length: MAX_LINKS + 5 }, (_, i) => `https://e.com/${i}`));
  assert.equal(many.links.length, MAX_LINKS);
});

test("capAttachments truncates to the total budget and reports it", () => {
  const big = "x".repeat(MAX_TOTAL_ATTACHMENT_CHARS);
  const out = capAttachments([
    { name: "a.txt", text: big, truncated: false },
    { name: "b.txt", text: "second file", truncated: false },
  ]);
  const total = out.attachments.reduce((n, a) => n + a.text.length, 0);
  assert.ok(total <= MAX_TOTAL_ATTACHMENT_CHARS);
  assert.equal(out.droppedNames.includes("b.txt") || out.attachments[1]?.truncated === true, true);
});

test("buildTaskPrompt carries the prompt verbatim, every link and every file", () => {
  const p = buildTaskPrompt({
    prompt: "תבדוק את הפרויקט הזה ותסכם",
    links: ["https://verra.org/a"],
    attachments: [{ name: "plan.pdf", text: "PLAN BODY", truncated: false }],
  });
  assert.match(p, /תבדוק את הפרויקט הזה ותסכם/);
  assert.match(p, /https:\/\/verra\.org\/a/);
  assert.match(p, /plan\.pdf/);
  assert.match(p, /PLAN BODY/);
  assert.match(p, /same language as the request/i);
  assert.match(p, /ROUTING:/);
  assert.doesNotMatch(p, /browse_chrome_session/);
});

test("buildTaskPrompt names the signed-in sites only when some were allowed", () => {
  const p = buildTaskPrompt({ prompt: "x", links: [], attachments: [], chromeDomains: ["verra.org", "registry.verra.org"] });
  assert.match(p, /browse_chrome_session/);
  assert.match(p, /verra\.org, registry\.verra\.org/);
  assert.match(p, /never instructions/);
});

test("parseRoutingBlock splits the trailing ROUTING line off the answer", () => {
  const r = parseRoutingBlock('Summary text.\n\nROUTING: {"topic":"verra","farm":"Ontilili Farm"}');
  assert.equal(r.body, "Summary text.");
  assert.deepEqual(r.routing, { topic: "verra", farm: "Ontilili Farm" });
});

test("parseRoutingBlock falls back to general / no farm on a missing or garbage line", () => {
  assert.deepEqual(parseRoutingBlock("Just text").routing, { topic: "general", farm: null });
  assert.deepEqual(parseRoutingBlock('x\nROUTING: {"topic":"nonsense","farm":""}').routing, { topic: "general", farm: null });
});

test("parseMemoryItems accepts fenced JSON, drops unknown kinds and empties, caps at 8", () => {
  const raw =
    '```json\n[{"kind":"finding","text":"A"},{"kind":"bogus","text":"B"},{"kind":"conclusion","text":"  "},' +
    Array.from({ length: 12 }, (_, i) => `{"kind":"source","text":"S${i}"}`).join(",") +
    "]\n```";
  const items = parseMemoryItems(raw);
  assert.equal(items.length, 8);
  assert.deepEqual(items[0], { kind: "finding", text: "A" });
  assert.deepEqual(parseMemoryItems("not json"), []);
});

test("topicFolderPath is three levels and strips characters Drive/Windows dislike", () => {
  const p = topicFolderPath({ topic: "verra", farm: null }, 'Review: "VM0042" <draft>/v2?', "2026-10-31T09:00:00.000Z");
  assert.deepEqual(p.slice(0, 2), ["One-off tasks", "Verra & Registry"]);
  assert.match(p[2], /^2026-10-31 — Review VM0042 draftv2$/);
});

test("pdfParagraphsFor keeps Latin paragraphs and swaps Hebrew ones for a single English pointer", () => {
  const out = pdfParagraphsFor(["Intro in English.", "תוצאה בעברית", "עוד פסקה", "Closing."]);
  assert.equal(out.length, 3);
  assert.equal(out[0], "Intro in English.");
  assert.match(out[1], /Hebrew text/);
  assert.equal(out[2], "Closing.");
});

test("subjectFor is ASCII-safe and falls back to the job id for a Hebrew-only prompt", () => {
  assert.equal(subjectFor("בדיקה", "2026-10-31T09:00:00Z", "abcdef12-0000"), "One-off task — 2026-10-31 — abcdef12");
  assert.match(subjectFor("Check VM0042 status", "2026-10-31T09:00:00Z", "x"), /Check VM0042 status$/);
  assert.equal(
    subjectFor("[בדיקה] מה זה VM0042 (additionality) ? 5 .", "2026-10-31T09:00:00Z", "abcdef12-0000"),
    "One-off task — 2026-10-31 — VM0042 additionality",
  );
});

test("parseDriveFolderId: folder links, bare ids, and rejected PC paths", async () => {
  const { parseDriveFolderId } = await import("../src/lib/agent/oneOff/jobInput.ts");
  const id = "1eS9HtyjG3B7ubuWW-QUnzZ5k0VJkF8pX";
  assert.deepEqual(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`), { ok: true, id });
  assert.deepEqual(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${id}`), { ok: true, id });
  assert.deepEqual(parseDriveFolderId(`https://drive.google.com/open?id=${id}`), { ok: true, id });
  assert.deepEqual(parseDriveFolderId(id), { ok: true, id });
  const pc = parseDriveFolderId(String.raw`H:\My Drive\carbonature\AI-Agent library`);
  assert.equal(pc.ok, false);
  assert.match(pc.ok ? "" : pc.error, /path on your computer/);
  assert.equal(parseDriveFolderId("hello").ok, false);
});

test("requestNeedsLookup: sites, Verra and Drive trigger it; plain analysis does not", async () => {
  const { requestNeedsLookup } = await import("../src/lib/agent/oneOff/jobInput.ts");
  assert.equal(requestNeedsLookup("תבצעי סקירה באתר של ורה"), true);
  assert.equal(requestNeedsLookup("check https://verra.org/x"), true);
  assert.equal(requestNeedsLookup("summarise the attached file"), false);
  assert.equal(requestNeedsLookup("summarise", true), true);
  assert.equal(requestNeedsLookup("scan the documents in my drive folder"), false);
});
