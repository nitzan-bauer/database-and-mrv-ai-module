import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import type { query as QueryFn } from "../../db";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "dave_email_activity_ingestion";

const SYSTEM_PROMPT = `You are Dave, CarboNature's GHG-quantification agent. You read one real email (its body text, any attachment text already extracted for you, and any image attachments — screenshots, photographed tables, handwritten logs — shown to you directly) and decide whether it reports GHG Calculator activity data for a real farm: fuel use (diesel/gasoline litres), fertiliser applications (name, mass, and — for organic amendments only — carbon content), residue burning, or N-fixing cover-crop residue, for a specific year.

The email, and any image, may be in Hebrew or mix Hebrew and English. Read it in whatever language it's in — do not ask for a translation. The farm name and every fertiliser name in your JSON response must still be given as they appear in the "Known real farms" / "Known real fertilizer catalog names" lists below (both are in Latin script) — translate/transliterate a Hebrew name to whichever catalog entry it clearly refers to (e.g. "אוריאה 46-0-0" -> the catalog's "Urea 46-0-0"). If you are not confident which real catalog entry a Hebrew name refers to, write your best literal reading of it as-is rather than guessing a catalog name — an incorrect guess is worse than an honest mismatch, because mismatches get reviewed by a person and guesses don't.

Respond with ONLY a single JSON object, no prose, no markdown fence. Two shapes are valid:

1) The email is NOT a GHG activity-data submission (e.g. it's unrelated correspondence):
   {"notActivityData": true, "reason": "<one short sentence why>"}

2) The email IS a GHG activity-data submission — for ONE farm, but possibly covering SEVERAL years at once (a common real case: a farmer sends 3 years of baseline fuel use broken down year by year in one message). "records" holds one entry per distinct (scenario, year):
   {
     "notActivityData": false,
     "farmName": "<the farm name exactly as it appears, or your best reading of it>",
     "records": [
       {
         "scenario": "BSL" | "PR",
         "year": <integer>,
         "areaHa": <number>,
         "dieselL": <number, 0 if not mentioned>,
         "gasolineL": <number, 0 if not mentioned>,
         "residueBurntKg": <number, 0 if not mentioned>,
         "nfixDryMatterT": <number, 0 if not mentioned>,
         "nfixNContent": <number 0-1, 0 if not mentioned>,
         "fertilizers": [
           {"fertilizerName": "<name as written>", "massT": <number>, "intervalYears": <integer, 1 if not stated>, "carbonContent": <number 0-1 or null — organic amendments only, only if the email states a lab-confirmed value>}
         ]
       }
     ],
     "confidence": "high" | "low",
     "notes": "<anything you were unsure about — read by a human before this is recorded>"
   }

BSL means a year before the project started (a historical/baseline record — 3 such years is typical); PR means a project/monitoring year. If the same areaHa applies to every year mentioned, repeat it on every record rather than omitting it — each record must stand alone. If the email doesn't say which scenario a year belongs to, use your best judgement from context (a real farm's own "before we started with CarboNature" framing is a stronger signal than the year number alone) and set "confidence": "low".

Never invent a farm name, a fertiliser name, or a number the email doesn't support. If the farm or a fertiliser name is genuinely ambiguous, write it exactly as the email states it — matching against the real catalog happens after you respond, not by you guessing a canonical name.`;

interface ExtractedFertilizer {
  fertilizerName: string;
  massT: number;
  intervalYears?: number;
  carbonContent?: number | null;
}

interface ExtractedRecord {
  scenario: "BSL" | "PR";
  year: number;
  areaHa: number;
  dieselL?: number;
  gasolineL?: number;
  residueBurntKg?: number;
  nfixDryMatterT?: number;
  nfixNContent?: number;
  fertilizers: ExtractedFertilizer[];
}

interface ExtractedActivityData {
  notActivityData: false;
  farmName: string;
  records: ExtractedRecord[];
  confidence: "high" | "low";
  notes?: string;
}

type ExtractionResult = { notActivityData: true; reason: string } | ExtractedActivityData;

function parseExtraction(text: string): ExtractionResult | null {
  try {
    const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    return JSON.parse(cleaned) as ExtractionResult;
  } catch {
    return null;
  }
}

type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** Claude's vision input accepts exactly these 4 formats — anything else (heic, bmp, tiff) is not a supported media_type and must fall through as an unreadable attachment rather than be sent and rejected by the API. */
function imageMediaTypeFor(mimeType: string, filename: string): ImageMediaType | null {
  const mt = mimeType.toLowerCase();
  if (mt === "image/png" || mt === "image/jpeg" || mt === "image/gif" || mt === "image/webp") return mt;
  const ext = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return null;
}

const MAX_EMAILS_PER_RUN = 10;
const MAX_BODY_CHARS = 20_000;

/**
 * Dave's inbox → real GHG activity data. Reads unprocessed mail sent to
 * his own address, extracts fuel/fertiliser figures via the model, and
 * either records them directly (clean extraction, exact farm + catalog
 * match, plausible values) or drops the resolved input into the same
 * pending_agent_actions queue every other 'confirm' action uses — never
 * a second, bespoke review mechanism.
 *
 * Nothing here guesses a farm or a fertiliser name to make an extraction
 * "work": an unmatched name is exactly the kind of gap that goes to a
 * human, because a silently-wrong farm_id is a silently-wrong emissions
 * figure for that farm forever after.
 */
export async function runDaveEmailActivityIngestion(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  if (!ctx.googleAccessToken) {
    return { ok: false, detail: "dave_email_activity_ingestion: no Google access token for the service account." };
  }

  const { query } = await import("../../db");
  const { searchGmailMessages, getMessagePlainTextBody, listMessageAttachments, getMessageAttachmentData } =
    await import("../../google/gmailClient");
  const { extractAttachmentText } = await import("../extractAttachmentText");
  const { agentSenderEmail } = await import("../agentEmailAliases");
  const { getFarmById, listFarms, listFertilizers } = await import("../../data");
  const { getConfiguredProvider } = await import("../../agent/provider");
  const { recallLessons, recordLesson } = await import("../lessonMemory");
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");

  const daveEmail = agentSenderEmail("dave");

  // Nitzan's own request (chat, 2026-09-12), after the first live test
  // showed the model has no way to know a real farm's actual area: the
  // "Run Now" control now offers a 2-step picker (farm, grouped by
  // project, then the exact sender address the data came from) before it
  // calls this handler. The picker spans every real project (including
  // demo ones — the picked farm could be, and was in the first live
  // test, a demo one), not just TARGET_PROJECT_ID — every other
  // scheduled task in this codebase is scoped to that one project, but
  // this is the first one driven by an explicit human farm choice rather
  // than an implicit "the one real project" assumption, so it must not
  // silently reject a farm the picker itself just offered.
  const scopedFarmId = ctx.taskParams?.farmId;
  const scopedSenderEmail = ctx.taskParams?.senderEmail?.trim();
  const scopedFarm = scopedFarmId ? await getFarmById(scopedFarmId) : null;
  if (scopedFarmId && !scopedFarm) {
    return { ok: false, detail: `dave_email_activity_ingestion: no farm "${scopedFarmId}" in any project — stale picker selection?` };
  }
  const scoped = Boolean(scopedFarm && scopedSenderEmail);

  // The farm/fertilizer-catalog context shown to the model, and the
  // unscoped audit's exact-name matching, both stay scoped to
  // TARGET_PROJECT_ID — unaffected by the scoped path above, which
  // already knows its farm directly and never needs this list to guess.
  const farms = await listFarms(TARGET_PROJECT_ID);
  const fertilizers = await listFertilizers();
  const farmByName = new Map(farms.map((f) => [f.name.trim().toLowerCase(), f]));
  const fertilizerNames = new Set(fertilizers.map((f) => f.name));

  // Confirmed live 2026-09-12: at launch, a farmer's data email goes to
  // Nitzan personally (he's the one who called and asked for it), not to
  // dave@carbonature.io — that's the whole reason this is a manual "tell
  // Dave to go look" trigger rather than an automatic scan of Dave's own
  // inbox. The service account authenticates as Nitzan (serviceAuth.ts's
  // own default), so "to:me" is his address; `to:${daveEmail}` stays in
  // the unscoped query for the case a sender does address Dave directly.
  // A 14-day window, not "since last run": there is no recurring cadence
  // to anchor to for a manual trigger, and real traffic is sparse enough
  // that scanning a wider recent window costs one extra skipped-message
  // log row per irrelevant email, not a real problem.
  const searchQuery = scoped
    ? `from:${scopedSenderEmail} newer_than:30d`
    : `(to:${daveEmail} OR to:me) newer_than:14d`;
  let messages;
  try {
    messages = await searchGmailMessages(ctx.googleAccessToken, searchQuery, MAX_EMAILS_PER_RUN);
  } catch (e) {
    return { ok: false, detail: `dave_email_activity_ingestion: Gmail search failed — ${e instanceof Error ? e.message : e}` };
  }

  const already = await query<{ gmail_id: string }>(
    `SELECT gmail_id FROM mrv.activity_data_email_ingestion_log WHERE gmail_id = ANY($1)`,
    [messages.map((m) => m.gmailId)],
  );
  const seen = new Set(already.map((r) => r.gmail_id));
  const toProcess = messages.filter((m) => !seen.has(m.gmailId)).slice(0, MAX_EMAILS_PER_RUN);

  const pastLessons = await recallLessons(ctx, { actionName: TASK_KEY, projectId: TARGET_PROJECT_ID });
  const lessonsBlock = pastLessons.length
    ? "\n\nLessons from past runs (apply these):\n" + pastLessons.map((l) => `- ${l.content}`).join("\n")
    : "";

  let recorded = 0;
  let needsReview = 0;
  let notData = 0;
  let failed = 0;
  const reviewSummaries: string[] = [];

  for (const msg of toProcess) {
    let body: string;
    try {
      body = await getMessagePlainTextBody(ctx.googleAccessToken, msg.gmailId);
    } catch {
      body = msg.snippet ?? "";
    }

    let attachmentText = "";
    const images: Array<{ mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; base64: string }> = [];
    const unreadableAttachments: string[] = [];
    try {
      const atts = await listMessageAttachments(ctx.googleAccessToken, msg.gmailId);
      for (const att of atts.slice(0, 3)) {
        const data = await getMessageAttachmentData(ctx.googleAccessToken, msg.gmailId, att.attachmentId);
        const imageMediaType = imageMediaTypeFor(att.mimeType, att.filename);
        if (imageMediaType) {
          // A screenshot of a fertilisation plan or a fuel log is real data,
          // not something to skip — Claude reads it directly (vision), not
          // via a separate OCR step. Confirmed necessary live 2026-09-12:
          // a real farmer email attached exactly this, as a screenshot.
          images.push({ mediaType: imageMediaType, base64: data.toString("base64") });
          continue;
        }
        const result = await extractAttachmentText({ name: att.filename, base64: data.toString("base64") });
        if (result.ok) attachmentText += `\n\n--- ${att.filename} ---\n${result.data.text}`;
        else unreadableAttachments.push(`${att.filename} (${result.error})`);
      }
    } catch {
      // Attachments are a bonus, not a requirement — the body alone may already say everything.
    }

    const combined = (body + attachmentText).slice(0, MAX_BODY_CHARS);
    if (!combined.trim() && images.length === 0) {
      await logOutcome(query, msg.gmailId, "not_activity_data", "empty body and no readable attachment", null);
      notData++;
      continue;
    }

    const provider = await getConfiguredProvider();
    let resp;
    try {
      resp = await provider.complete({
        system: SYSTEM_PROMPT,
        userMessage:
          `Subject: ${msg.subject ?? "(no subject)"}\nFrom: ${msg.fromEmail}\n\n` +
          `Known real farms in this project: ${farms.map((f) => f.name).join(", ")}\n` +
          `Known real fertilizer catalog names: ${fertilizers.map((f) => f.name).join(", ")}\n\n` +
          (scoped
            ? `This submission is already confirmed to be about ${scopedFarm!.name}, whose real registered area is ${scopedFarm!.totalAreaHa} ha — use "${scopedFarm!.name}" as farmName, and use exactly ${scopedFarm!.totalAreaHa} for areaHa on every record. If the email states fertiliser or fuel figures per hectare (e.g. "300 kg/ha"), multiply by ${scopedFarm!.totalAreaHa} ha yourself to get the real total (massT = kg/ha × ha ÷ 1000) — do not omit a fertiliser just because it was given per-hectare, the area to convert it with is right here.\n\n`
            : "") +
          `Email content (may be in Hebrew — read it in the original language, respond in the JSON shape specified):\n${combined || "(no body text)"}` +
          (images.length ? `\n\n${images.length} image attachment(s) follow — read any table/handwriting/screenshot in them as part of the same submission.` : "") +
          (unreadableAttachments.length ? `\n\nNote: could not read these attachments as text: ${unreadableAttachments.join(", ")}.` : "") +
          lessonsBlock,
        tools: [],
        images: images.length ? images : undefined,
        timeoutMs: 30_000,
        // Confirmed live 2026-09-12: 2048 was already not enough once a
        // real image made the model actually describe several years of
        // fertiliser lines — the response was cut off mid-JSON and failed
        // to parse. A multi-year, multi-fertiliser submission with an
        // image genuinely needs more room than a text-only one.
        maxTokens: images.length ? 4096 : undefined,
      });
    } catch (e) {
      await logOutcome(query, msg.gmailId, "failed", `model call failed: ${e instanceof Error ? e.message : e}`, null);
      failed++;
      continue;
    }

    const text = resp.kind === "text" ? resp.text : "";
    const extraction = parseExtraction(text);
    if (!extraction) {
      await logOutcome(query, msg.gmailId, "failed", `could not parse model response: ${text.slice(0, 500)}`, null);
      failed++;
      continue;
    }

    if (extraction.notActivityData) {
      await logOutcome(query, msg.gmailId, "not_activity_data", extraction.reason, null);
      notData++;
      continue;
    }

    if (!extraction.records?.length) {
      await logOutcome(query, msg.gmailId, "failed", "model returned notActivityData: false but no records", null);
      failed++;
      continue;
    }

    const matchedFarm = scoped ? scopedFarm : farmByName.get(extraction.farmName.trim().toLowerCase());
    const { recordActivityData } = await import("../../tools/recordActivityData");

    // One email can legitimately report several years at once (a farmer's
    // full 3-year baseline in one message) — each (scenario, year) is
    // audited and recorded independently, so one bad year doesn't block
    // the two clean ones next to it.
    let emailRecorded = 0;
    let emailReviewed = 0;
    const emailDetails: string[] = [];

    for (const record of extraction.records) {
      const auditIssues: string[] = [];
      if (!matchedFarm) {
        auditIssues.push(
          `farm name "${extraction.farmName}" does not exactly match any real farm (${farms.map((f) => f.name).join(", ")})`,
        );
      } else if (scoped && !(scopedFarm!.totalAreaHa > 0)) {
        // The one case even a scoped, farm-known submission can't resolve
        // on its own: the chosen farm has no registered plot area at all.
        auditIssues.push(`${scopedFarm!.name} has no registered plot area (total_area_ha is 0) — record real plots for it first`);
      }
      const unmatchedFertilizers = record.fertilizers.filter((f) => !fertilizerNames.has(f.fertilizerName));
      if (unmatchedFertilizers.length) {
        auditIssues.push(
          `fertilizer name(s) not in the catalog exactly: ${unmatchedFertilizers.map((f) => f.fertilizerName).join(", ")}`,
        );
      }
      if (!scoped && (!Number.isFinite(record.areaHa) || record.areaHa <= 0)) {
        auditIssues.push(`areaHa (${record.areaHa}) is not a positive number`);
      }
      if (!Number.isInteger(record.year) || record.year < 2015 || record.year > new Date().getFullYear() + 1) {
        auditIssues.push(`year (${record.year}) looks wrong`);
      }
      for (const f of record.fertilizers) {
        if (f.carbonContent != null && (f.carbonContent < 0 || f.carbonContent > 1)) {
          auditIssues.push(`"${f.fertilizerName}" carbonContent (${f.carbonContent}) is not a fraction between 0 and 1`);
        }
      }
      if (extraction.confidence === "low") {
        auditIssues.push(`Dave's own extraction confidence was low${extraction.notes ? ` — ${extraction.notes}` : ""}`);
      }

      const activityFields = {
        scenario: record.scenario,
        year: record.year,
        // Real, registered plot area wins over whatever the model read —
        // it was told this exact number, but the DB value is the one
        // recordActivityData actually needs to be right, not a repeat of
        // an instruction the model might not have followed precisely.
        areaHa: scoped ? scopedFarm!.totalAreaHa : record.areaHa,
        dieselL: record.dieselL ?? 0,
        gasolineL: record.gasolineL ?? 0,
        residueBurntKg: record.residueBurntKg ?? 0,
        nfixDryMatterT: record.nfixDryMatterT ?? 0,
        nfixNContent: record.nfixNContent ?? 0,
        fertilizers: record.fertilizers.map((f) => ({
          fertilizerName: f.fertilizerName,
          massT: f.massT,
          intervalYears: f.intervalYears ?? 1,
          carbonContent: f.carbonContent ?? undefined,
        })),
      };

      if (auditIssues.length > 0) {
        const reason = `Extracted from email "${msg.subject ?? msg.gmailId}" from ${msg.fromEmail} (${record.scenario} ${record.year}): ${auditIssues.join("; ")}.`;
        const pendingInput = { farmId: matchedFarm?.farmId ?? null, ...activityFields };
        try {
          await query(
            `INSERT INTO mrv.pending_agent_actions (agent_id, action_name, input, reason, requested_by)
             VALUES ('dave', 'record_activity_data', $1::jsonb, $2, $3)`,
            [JSON.stringify(pendingInput), reason, `email:${msg.fromEmail}`],
          );
        } catch (e) {
          console.warn(`[dave_email_activity_ingestion] could not queue pending action: ${e instanceof Error ? e.message : e}`);
        }
        emailReviewed++;
        reviewSummaries.push(reason);
        emailDetails.push(`${record.scenario} ${record.year}: needs review — ${auditIssues.join("; ")}`);
        continue;
      }

      const result = await recordActivityData(ctx, { farmId: matchedFarm!.farmId, ...activityFields });
      if (result.ok) {
        emailRecorded++;
        emailDetails.push(`${record.scenario} ${record.year}: recorded`);
      } else {
        emailDetails.push(`${record.scenario} ${record.year}: failed — ${result.error}`);
      }
    }

    recorded += emailRecorded;
    needsReview += emailReviewed;
    const emailFailed = extraction.records.length - emailRecorded - emailReviewed;
    failed += emailFailed;
    await logOutcome(
      query,
      msg.gmailId,
      emailReviewed > 0 ? "needs_review" : emailFailed > 0 ? "failed" : "recorded",
      `${matchedFarm?.name ?? extraction.farmName} — ${emailDetails.join(" | ")}`,
      matchedFarm?.farmId ?? null,
    );
  }

  const summary = `Scanned ${toProcess.length} new email(s): ${recorded} recorded, ${needsReview} sent for review, ${notData} not activity data, ${failed} failed.`;
  await recordLesson(ctx, {
    agentId: "dave",
    actionName: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    outcomeSummary: summary + (reviewSummaries.length ? ` Review reasons: ${reviewSummaries.join(" | ")}` : ""),
  });

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `GHG activity-data email ingestion — ${new Date().toISOString().slice(0, 10)}`,
    bodyParagraphs: [
      summary,
      needsReview > 0
        ? `${needsReview} submission(s) need your review at /agents/approvals before they're recorded.`
        : "Nothing needs your review this run.",
    ],
    memoryKind: "email_activity_ingestion",
    sendEmail: recorded + needsReview + failed > 0,
    agentId: "dave",
    domain: "mrv",
  });

  return { ok: outcome.ok, detail: `${outcome.detail} (${summary})` };
}

async function logOutcome(
  query: typeof QueryFn,
  gmailId: string,
  outcome: "recorded" | "needs_review" | "not_activity_data" | "failed",
  detail: string | null | undefined,
  farmId: string | null,
): Promise<void> {
  await query(
    `INSERT INTO mrv.activity_data_email_ingestion_log (gmail_id, outcome, detail, farm_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (gmail_id) DO NOTHING`,
    [gmailId, outcome, detail ?? null, farmId],
  );
}
