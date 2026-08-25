#!/usr/bin/env node
/**
 * Weekly Verra webinar RECORDING scan — transcribes and summarizes
 * VM0042/ALM recordings, additive to the existing written-recap scan
 * (weeklyVerraWebinarScan.ts), which can only report Verra's own blurb.
 *
 * Runs as a plain GitHub Actions cron job, not an Anthropic cloud
 * routine — confirmed live 2026-08-25 that the cloud-routine sandbox's
 * fixed network-egress allowlist blocks verra.org, api.groq.com, AND
 * this repo's own Vercel API, with no way to add exceptions to it.
 * GitHub's own runners have unrestricted egress.
 *
 * Deterministic everywhere it can be (page fetch, dedupe, download,
 * transcription) — Claude is only called for the two genuinely
 * judgment-requiring steps: extracting/filtering candidates from raw
 * page text, and writing the English summary from a transcript.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";

const RECORDINGS_URL = "https://verra.org/webinar-recordings/";
const ENDPOINT =
  process.env.MRV_ENDPOINT ?? "https://database-and-mrv-ai-module.vercel.app/api/agents/rebeka/webinar-recording-summary";
const MODEL = process.env.AGENT_MODEL_ID?.trim() || "claude-sonnet-5";
const AUDIO_PATH = "/tmp/webinar-recording.mp3";
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // Groq's 25MB cap, with headroom

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

const GROQ_KEY = requireEnv("GROQ_API_KEY");
const ANTHROPIC_KEY = requireEnv("ANTHROPIC_API_KEY");
const AGENT_SECRET = requireEnv("EXTERNAL_AGENT_SECRET");

/** Same tag-stripping approach as src/lib/tools/fetchPublicUrl.ts — no HTML-parsing dependency for a shape this simple. */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, base) {
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const resolved = new URL(m[1], base);
      if (resolved.protocol === "https:") seen.add(resolved.toString());
    } catch {
      // malformed href — skip it
    }
  }
  return [...seen];
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { "user-agent": "CarboNature-MRV/1.0 (+https://carbonature.io)" } });
  const html = await res.text();
  return { html, text: htmlToText(html).slice(0, 12000), links: extractLinks(html, new URL(url)) };
}

async function callClaude(system, userMessage, maxTokens = 1536) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: userMessage }] }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

// .trim() BEFORE stripping fences — an unanchored strip on untrimmed input silently no-ops.
function stripFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function reportToMrv(payload) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${AGENT_SECRET}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  console.log(`[report ${res.status}]`, JSON.stringify(body));
  if (!res.ok) throw new Error(`report failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function alreadyProcessed() {
  const res = await fetch(ENDPOINT, { headers: { authorization: `Bearer ${AGENT_SECRET}` } });
  if (!res.ok) throw new Error(`dedupe check failed: ${res.status}`);
  return (await res.json()).alreadyProcessed ?? [];
}

function titleSimilar(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

const EXTRACTION_SYSTEM =
  "You extract structured data from the raw text of Verra's public webinar-recordings page (verra.org). " +
  'Return ONLY a JSON object, no prose, no markdown fences: {"candidates":[{"title":string,' +
  '"description":string,"pageUrl":string|null,"relevant":boolean}]}. "pageUrl" is the best-matching https:// ' +
  "link from the list provided for that specific recording (or null if none matches). \"relevant\" is true " +
  'only if the title/description is clearly about VM0042 (the VCS methodology "Methodology for Improved ' +
  'Agricultural Land Management") or the broader ALM (Agricultural Land Management) project category — ' +
  "everything else (REDD+, forestry, blue carbon, registry/policy topics unrelated to ALM) is relevant:false. " +
  "Never invent an entry; if nothing is found, return an empty candidates array.";

async function findCandidates() {
  const page = await fetchPage(RECORDINGS_URL);
  const raw = await callClaude(
    EXTRACTION_SYSTEM,
    `Page text:\n${page.text}\n\nLinks found on the page:\n${page.links.slice(0, 40).join("\n")}`,
  );
  try {
    const parsed = JSON.parse(stripFences(raw));
    return (parsed.candidates ?? []).filter((c) => c.relevant);
  } catch {
    console.error("Could not parse extraction JSON:", raw.slice(0, 500));
    return [];
  }
}

/** Verra links to a page with an embedded player, not a raw video URL — resolve the actual YouTube/Vimeo link yt-dlp needs. */
async function resolveVideoUrl(pageUrl) {
  if (!pageUrl) return null;
  try {
    const page = await fetchPage(pageUrl);
    const embed = page.html.match(/(?:youtube\.com\/embed\/|youtu\.be\/|player\.vimeo\.com\/video\/)([\w-]+)/i);
    if (embed) {
      if (embed[0].includes("vimeo")) return `https://vimeo.com/${embed[1]}`;
      return `https://www.youtube.com/watch?v=${embed[1]}`;
    }
    const direct = page.links.find((l) => /youtube\.com\/watch|youtu\.be\/|vimeo\.com\//.test(l));
    if (direct) return direct;
  } catch (e) {
    console.error(`could not resolve video URL from ${pageUrl}: ${e.message}`);
  }
  return null;
}

function downloadAudio(videoUrl) {
  if (existsSync(AUDIO_PATH)) unlinkSync(AUDIO_PATH);
  execFileSync(
    "yt-dlp",
    ["-x", "--audio-format", "mp3", "--audio-quality", "5", "-o", AUDIO_PATH.replace(/\.mp3$/, ".%(ext)s"), videoUrl],
    { stdio: "inherit" },
  );
  if (!existsSync(AUDIO_PATH)) throw new Error("yt-dlp did not produce an mp3 file");
}

function ensureUnderUploadLimit() {
  if (statSync(AUDIO_PATH).size <= MAX_UPLOAD_BYTES) return;
  const small = AUDIO_PATH.replace(/\.mp3$/, "-small.mp3");
  execFileSync("ffmpeg", ["-y", "-i", AUDIO_PATH, "-b:a", "48k", small], { stdio: "inherit" });
  writeFileSync(AUDIO_PATH, readFileSync(small));
  unlinkSync(small);
  if (statSync(AUDIO_PATH).size > MAX_UPLOAD_BYTES) throw new Error("audio still over Groq's upload limit after re-encoding");
}

async function transcribe() {
  const form = new FormData();
  form.append("file", new Blob([readFileSync(AUDIO_PATH)]), "webinar.mp3");
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "text");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${GROQ_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq transcription failed: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

const SUMMARY_SYSTEM =
  "You summarize a Verra VM0042/ALM webinar transcript for a carbon-project developer. Write 3-6 short " +
  "English paragraphs covering: what the session actually covered; any VM0042/ALM methodology updates, " +
  "deadlines, or procedural changes mentioned; anything a project developer running a real ALM project " +
  "should act on; presenter names/roles if stated. Base this only on what the transcript actually says — " +
  'do not invent detail. Return ONLY JSON, no markdown fences: {"paragraphs":[string, ...]}';

async function summarize(transcript) {
  const raw = await callClaude(SUMMARY_SYSTEM, `Transcript:\n${transcript.slice(0, 60_000)}`, 2048);
  const parsed = JSON.parse(stripFences(raw));
  return parsed.paragraphs ?? [];
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const candidates = await findCandidates();
  if (!candidates.length) {
    await reportToMrv({
      subject: `Weekly Verra webinar recording check — ${today}`,
      skippedReason: "No VM0042/ALM-relevant recordings found on Verra's recordings page this run.",
    });
    console.log("Nothing relevant found. Done.");
    return;
  }

  const seen = await alreadyProcessed();
  const isNew = (c) =>
    !seen.some((s) => (c.pageUrl && s.sourceUrl && s.sourceUrl === c.pageUrl) || titleSimilar(s.subject, c.title));
  const fresh = candidates.filter(isNew);

  if (!fresh.length) {
    await reportToMrv({
      subject: `Weekly Verra webinar recording check — ${today}`,
      skippedReason: "Only already-summarized VM0042/ALM recordings were found this run.",
    });
    console.log("Nothing new. Done.");
    return;
  }

  for (const c of fresh) {
    try {
      const videoUrl = await resolveVideoUrl(c.pageUrl);
      if (!videoUrl) {
        await reportToMrv({ subject: c.title, skippedReason: `Could not resolve a video URL for "${c.title}" from ${c.pageUrl}` });
        continue;
      }
      downloadAudio(videoUrl);
      ensureUnderUploadLimit();
      const transcript = await transcribe();
      const paragraphs = await summarize(transcript);
      if (!paragraphs.length) throw new Error("summary produced no paragraphs");
      await reportToMrv({ subject: c.title, bodyParagraphs: paragraphs, sourceUrl: c.pageUrl ?? videoUrl });
    } catch (e) {
      console.error(`Failed on "${c.title}":`, e.message);
      await reportToMrv({ subject: c.title, skippedReason: `Processing failed: ${e.message}` }).catch(() => {});
    } finally {
      if (existsSync(AUDIO_PATH)) unlinkSync(AUDIO_PATH);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
