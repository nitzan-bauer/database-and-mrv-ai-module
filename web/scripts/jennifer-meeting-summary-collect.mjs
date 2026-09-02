#!/usr/bin/env node
/**
 * Collects a past weekly-work-meeting occurrence once its Recall.ai bot is
 * done recording: downloads the mixed audio, re-encodes it if needed,
 * transcribes it (Groq Whisper, Hebrew-capable), summarizes it in Hebrew
 * (Claude), and reports the result to the MRV app, which emails Nitzan
 * and Elad and updates mrv.jennifer_meeting_summaries.
 *
 * Runs as a plain GitHub Actions cron job, not inside the Vercel app —
 * confirmed live 2026-09-02 that a real ~36-minute meeting's full chain
 * (download + re-encode + transcribe + summarize + email) exceeds even
 * Vercel Hobby's maxDuration ceiling (60s, no higher tier available).
 * GitHub Actions' 30-minute job timeout has comfortable headroom, the
 * same reason webinar-recording-scan.mjs already runs here instead of
 * inside the app for rebeka_webinar_recording_summary.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync, unlinkSync } from "node:fs";

const ENDPOINT =
  process.env.MRV_ENDPOINT ?? "https://database-and-mrv-ai-module.vercel.app/api/agents/jennifer/meeting-summary-collect";
const MODEL = process.env.AGENT_MODEL_ID?.trim() || "claude-sonnet-5";
const AUDIO_PATH = "/tmp/jennifer-meeting.mp3";
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // Groq's 25MB cap, with headroom

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

const RECALL_KEY = requireEnv("RECALLAI_API_KEY");
const RECALL_REGION = process.env.RECALLAI_REGION?.trim() || "us-east-1";
const GROQ_KEY = requireEnv("GROQ_API_KEY");
const ANTHROPIC_KEY = requireEnv("ANTHROPIC_API_KEY");
const AGENT_SECRET = requireEnv("EXTERNAL_AGENT_SECRET");

const FAILURE_STATUSES = new Set(["fatal", "call_ended_error", "recording_permission_denied", "invalid_meeting_url"]);

/** Mirrors src/lib/recall/recallClient.ts#getBotStatus exactly — kept in
 * sync manually since this script can't import that TS module directly.
 * The media shortcut key is `audio_mixed` (format mp3 inside it), NOT
 * `audio_mixed_mp3` — confirmed live 2026-09-02 against a real bot. */
async function getBotStatus(botId) {
  const res = await fetch(`https://${RECALL_REGION}.recall.ai/api/v1/bot/${botId}/`, {
    headers: { Authorization: `Token ${RECALL_KEY}` },
  });
  if (!res.ok) throw new Error(`Recall.ai bot retrieve returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const latestStatus = data.status_changes?.length ? data.status_changes[data.status_changes.length - 1].code : null;
  const audioDownloadUrl = data.recordings?.[0]?.media_shortcuts?.audio_mixed?.data?.download_url ?? null;
  const failed = (data.status_changes ?? []).some((s) => FAILURE_STATUSES.has(s.code));
  return { audioReady: Boolean(audioDownloadUrl), audioDownloadUrl, failed, latestStatus };
}

async function callClaude(system, userMessage, maxTokens = 2048) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: userMessage }] }),
  });
  if (!res.ok) throw new Error(`Claude API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return (data.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}

function stripFences(text) {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

async function reportResult(payload) {
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

async function listPending() {
  const res = await fetch(ENDPOINT, { headers: { authorization: `Bearer ${AGENT_SECRET}` } });
  if (!res.ok) throw new Error(`pending list fetch failed: ${res.status}`);
  return (await res.json()).pending ?? [];
}

function downloadAudio(url) {
  if (existsSync(AUDIO_PATH)) unlinkSync(AUDIO_PATH);
  execFileSync("curl", ["-fsSL", "-o", AUDIO_PATH, url], { stdio: "inherit" });
  if (!existsSync(AUDIO_PATH)) throw new Error("download did not produce a file");
}

/** Same 48kbps webinar-recording-scan.mjs already proved keeps Whisper
 * transcription accurate — Recall's own bot-creation API has no
 * bitrate/quality option (confirmed live 2026-09-02 against their docs). */
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
  form.append("file", new Blob([readFileSync(AUDIO_PATH)]), "meeting.mp3");
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

// Mirrors jenniferMeetingSummary.ts's own HEBREW_SUMMARY_SYSTEM exactly —
// kept in sync manually since this script can't import that TS module.
const HEBREW_SUMMARY_SYSTEM =
  "אתה מסכם תמלול של פגישת עבודה שבועית בעברית, עבור שני המשתתפים בה. כתוב סיכום אמיתי — לא תרגום מילולי " +
  "ולא העתקה של קטעים מהתמלול — הכולל: הנושאים המרכזיים שנדונו, החלטות שהתקבלו, ומשימות/פעולות המשך אם צוינו " +
  "(עם שם האחראי אם נאמר). התבסס אך ורק על מה שנאמר בפועל בתמלול, אל תמציא פרטים. אם התמלול קצר מדי או לא " +
  'ברור, ציין זאת בכנות במקום לנחש. החזר אך ורק אובייקט JSON, בלי טקסט נוסף ובלי ```: {"paragraphs":[string, ...]}';

async function summarizeHebrew(transcript) {
  // Hebrew uses noticeably more tokens per word than English (confirmed
  // live 2026-09-02: callClaude's 2048-token default cut a real summary
  // off mid-string, breaking JSON parsing) — well above webinar-scan.mjs's
  // own English 2048, which has real headroom to spare by comparison.
  const raw = await callClaude(HEBREW_SUMMARY_SYSTEM, `תמלול:\n${transcript.slice(0, 60_000)}`, 4096);
  const parsed = JSON.parse(stripFences(raw));
  return parsed.paragraphs ?? [];
}

async function main() {
  const pending = await listPending();
  if (!pending.length) {
    console.log("Nothing pending. Done.");
    return;
  }

  for (const p of pending) {
    try {
      const status = await getBotStatus(p.bot_id);

      if (status.failed) {
        await reportResult({ summaryId: p.summary_id, result: "failed", failureReason: `Recording bot failed (latest status: ${status.latestStatus ?? "unknown"}).` });
        continue;
      }
      if (!status.audioReady) {
        await reportResult({ summaryId: p.summary_id, result: "still_waiting" });
        continue;
      }

      downloadAudio(status.audioDownloadUrl);
      ensureUnderUploadLimit();
      const transcript = await transcribe();
      if (!transcript.trim()) throw new Error("transcription came back empty");

      const paragraphs = await summarizeHebrew(transcript);
      if (!paragraphs.length) throw new Error("Hebrew summary came back empty");

      await reportResult({ summaryId: p.summary_id, result: "ready", paragraphs });
    } catch (e) {
      console.error(`Failed on meeting ${p.meeting_date}:`, e.message);
      await reportResult({ summaryId: p.summary_id, result: "failed", failureReason: e.message }).catch(() => {});
    } finally {
      if (existsSync(AUDIO_PATH)) unlinkSync(AUDIO_PATH);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
