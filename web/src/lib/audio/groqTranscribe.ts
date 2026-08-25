import "server-only";

/**
 * Groq's Whisper API (openai-compatible), the same choice already proven
 * live this session for the webinar-recording pipeline
 * (scripts/webinar-recording-scan.mjs) — genuinely Hebrew-capable, unlike
 * Google Meet's own transcript feature. This is the in-app copy for
 * jenniferMeetingSummary.ts, which runs inside Next.js rather than a
 * standalone script, so it takes the audio as an already-fetched Buffer
 * rather than a local file path.
 */
export async function transcribeAudioBuffer(apiKey: string, audio: Buffer, fileName = "meeting.mp3"): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)]), fileName);
  form.append("model", "whisper-large-v3-turbo");
  form.append("response_format", "text");
  form.append("language", "he"); // Hebrew — skips language auto-detection, more reliable for a short mixed-audio call

  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Groq transcription returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.text();
}
