import "server-only";

/**
 * Recall.ai's Meeting Bot API, over plain fetch — same choice made for
 * every other HTTP integration in this repo (anthropicProvider.ts,
 * calendarClient.ts, driveClient.ts).
 *
 * Exists because Google Meet's own "take notes"/transcript feature does
 * not support Hebrew (confirmed live 2026-08-25 against Google's own
 * docs: English, French, German, Italian, Japanese, Korean, Portuguese,
 * Spanish only) — and CarboNature's weekly meeting is conducted in
 * Hebrew. A bot joining the call and capturing raw audio, transcribed
 * separately via Groq Whisper (already proven Hebrew-capable this
 * session, see webinar-recording-scan.mjs), sidesteps that language gap
 * entirely rather than waiting for Google to add Hebrew.
 *
 * Confirmed live via docs.recall.ai, 2026-08-25: base URL is
 * https://$REGION.recall.ai/api/v1/, auth is `Authorization: Token
 * $KEY`, and `join_at` set >=10 minutes ahead lets Recall's own
 * infrastructure handle the precise join timing — this code only ever
 * needs to call schedule once, any time before the meeting, not at the
 * exact minute it starts.
 */

function baseUrl(region: string): string {
  return `https://${region}.recall.ai/api/v1`;
}

export interface ScheduledBot {
  botId: string;
}

/**
 * Schedule a bot to join `meetingUrl` at `joinAtIso`. Audio-only
 * recording — this task never needs video, and requesting less media
 * keeps Recall's own per-hour cost down.
 */
export async function scheduleBotJoin(
  apiKey: string,
  region: string,
  meetingUrl: string,
  joinAtIso: string,
  botName = "Jennifer (CarboNature)",
): Promise<ScheduledBot> {
  const res = await fetch(`${baseUrl(region)}/bot/`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      meeting_url: meetingUrl,
      bot_name: botName,
      join_at: joinAtIso,
      recording_config: { audio_mixed_mp3: {} },
    }),
  });
  if (!res.ok) throw new Error(`Recall.ai bot create returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { id: string };
  return { botId: data.id };
}

export interface BotStatus {
  /** True once the call has ended AND the mixed audio recording is ready to download. */
  audioReady: boolean;
  audioDownloadUrl: string | null;
  /** True if the bot's own status history shows a failure (e.g. it couldn't join — meeting cancelled, link expired, not admitted). */
  failed: boolean;
  /** The most recent status code, for logging/diagnostics — Recall's own vocabulary, not normalized here. */
  latestStatus: string | null;
}

const FAILURE_STATUSES = new Set(["fatal", "call_ended_error", "recording_permission_denied", "invalid_meeting_url"]);

/**
 * bot.retrieve — reads back whether the recording is ready yet.
 * Deliberately checks for the download URL itself rather than matching a
 * specific "done" status string, since Recall's own status vocabulary is
 * secondary to the one fact that can't be misread: does the mixed-audio
 * media shortcut have a download URL.
 *
 * The shortcut key is `audio_mixed` (format "mp3" inside it), NOT
 * `audio_mixed_mp3` — confirmed live 2026-09-02 against a real completed
 * bot (id bc82b3e5-…) whose audio had been sitting ready since the meeting
 * ended on 2026-08-31, silently missed every day since because this
 * function was checking a key that never existed in Recall's real
 * response. Written before any live bot had run; never verified against
 * one until this bug surfaced.
 */
export async function getBotStatus(apiKey: string, region: string, botId: string): Promise<BotStatus> {
  const res = await fetch(`${baseUrl(region)}/bot/${botId}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Recall.ai bot retrieve returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as {
    status_changes?: { code: string }[];
    recordings?: { media_shortcuts?: { audio_mixed?: { data?: { download_url?: string } } } }[];
  };
  const latestStatus = data.status_changes?.length ? data.status_changes[data.status_changes.length - 1].code : null;
  const audioDownloadUrl = data.recordings?.[0]?.media_shortcuts?.audio_mixed?.data?.download_url ?? null;
  const failed = (data.status_changes ?? []).some((s) => FAILURE_STATUSES.has(s.code));
  return { audioReady: Boolean(audioDownloadUrl), audioDownloadUrl, failed, latestStatus };
}
