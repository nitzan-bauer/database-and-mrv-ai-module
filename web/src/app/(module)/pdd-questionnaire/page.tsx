import { redirect } from "next/navigation";

/**
 * Retired (Nitzan's own re-spec, live this session — "PDD SEED
 * QUESTIONNAIRE.docx": delete the old questionnaire, start from
 * scratch). Its two jobs split in two:
 *  - SEED intake (project name, related projects, baseline scenario…)
 *    is now a collapsed block on Rebeka's own page (/agents) — see
 *    SeedQuestionnaireBlock — not a separate route.
 *  - Per-section drafting/review of the VCS template's own 96 sections
 *    is PDD Development's job (/pdd-development), unchanged.
 * This route stays only so an old bookmark or link lands somewhere
 * real instead of a 404.
 */
export default async function PddQuestionnairePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project } = await searchParams;
  redirect(project ? `/agents?project=${encodeURIComponent(project)}` : "/agents");
}
