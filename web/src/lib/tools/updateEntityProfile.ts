import "server-only";
import { audit, checkPolicy, fail, ok, requireDbMode, type ToolContext, type ToolResult } from "./context";

export type EntityType = "lab" | "vvb" | "farm" | "contractor";
const ENTITY_TYPES: EntityType[] = ["lab", "vvb", "farm", "contractor"];

export interface UpdateEntityProfileInput {
  entityType: EntityType;
  /** Free text — a VVB/contractor has no id of its own, so this is whatever name/reference already identifies it elsewhere (e.g. mrv.vvb_findings.raised_by), or a real uuid for lab/farm. */
  entityId: string;
  /** The new fact/observation to fold in — e.g. "Lab X's Q3 batch had 2 quarantined samples, both underreporting SOC by ~2%." */
  newEvidence: string;
}

export interface UpdatedEntityProfile {
  profileText: string;
  evidenceCount: number;
}

const PROFILE_SYSTEM_PROMPT =
  "You maintain a running profile of one real recurring entity (a lab, VVB, farm, or contractor) for CarboNature's " +
  "MRV agents to consult before dealing with it again. You are given the CURRENT profile (or none, if this is the " +
  "first observation) and one new piece of evidence. Write the UPDATED profile: fold the new evidence in, keep " +
  "every still-relevant fact from the old profile, and if the new evidence contradicts something in the old " +
  "profile, state the more recent/reliable view and note that it supersedes the earlier one — do not silently " +
  "drop the contradiction. 2-5 concrete sentences, plain prose. Never invent a fact neither the old profile nor " +
  "the new evidence actually states.";

/**
 * Stage 8 (agent learning-layer plan): a profile is UPDATED, not
 * appended to — this is what distinguishes it from mrv.agent_memory's
 * episodic notes. Every call reads the current text, asks the model to
 * fold the new evidence in, and overwrites the row — so ten calls about
 * the same lab produce one increasingly refined paragraph, not ten
 * competing notes.
 */
export async function updateEntityProfile(
  ctx: ToolContext,
  input: UpdateEntityProfileInput,
): Promise<ToolResult<UpdatedEntityProfile>> {
  const guard = requireDbMode("updateEntityProfile");
  if (guard) return guard;

  const policy = await checkPolicy("update_entity_profile", ctx);
  if (!policy.allowed) return fail(policy.reason!, true);

  if (!ENTITY_TYPES.includes(input.entityType)) {
    return fail(`updateEntityProfile: entityType must be one of ${ENTITY_TYPES.join(", ")}.`);
  }
  if (!input.entityId?.trim()) return fail("updateEntityProfile: entityId is required.");
  if (!input.newEvidence?.trim()) return fail("updateEntityProfile: newEvidence is required.");

  const { query } = await import("../db");

  const existing = await query<{ profile_text: string; evidence_count: number }>(
    `SELECT profile_text, evidence_count FROM mrv.entity_profile WHERE entity_type = $1 AND entity_id = $2`,
    [input.entityType, input.entityId.trim()],
  );
  const currentProfile = existing[0]?.profile_text ?? null;

  const { getConfiguredProvider } = await import("../agent/provider");
  const provider = await getConfiguredProvider();
  const resp = await provider.complete({
    system: PROFILE_SYSTEM_PROMPT,
    userMessage:
      (currentProfile ? `Current profile:\n${currentProfile}` : "No profile exists yet — this is the first observation.") +
      `\n\nNew evidence:\n${input.newEvidence.trim()}`,
    tools: [],
    maxTokens: 1024,
  });
  const profileText = resp.kind === "text" ? resp.text.trim() : null;
  if (!profileText) return fail("updateEntityProfile: the model returned no profile text.");

  const evidenceCount = (existing[0]?.evidence_count ?? 0) + 1;
  await query(
    `INSERT INTO mrv.entity_profile (entity_type, entity_id, profile_text, evidence_count, updated_at)
     VALUES ($1, $2, $3, $4, clock_timestamp())
     ON CONFLICT (entity_type, entity_id) DO UPDATE SET
       profile_text = excluded.profile_text,
       evidence_count = excluded.evidence_count,
       updated_at = clock_timestamp()`,
    [input.entityType, input.entityId.trim(), profileText, evidenceCount],
  );

  await audit(ctx, "update_entity_profile", { type: "entity_profile", id: `${input.entityType}:${input.entityId.trim()}` }, {
    entityType: input.entityType,
    evidenceCount,
  });

  return ok({ profileText, evidenceCount });
}
