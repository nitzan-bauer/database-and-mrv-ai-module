import "server-only";
import type { ToolContext } from "../../tools/context";
import type { ScheduledTaskOutcome } from "../scheduledTaskRegistry";
import { TARGET_PROJECT_ID } from "./constants";

export const TASK_KEY = "john_allocation_report";

/**
 * John's weekly Allocation Book report — Round 3 rewrite (2026-08-31),
 * the full 3-chapter rebuild per the approved spec (see agent-memory
 * project_mrv_allocation_book_spec): Chapter 1 (Buyer Transactions
 * Ledger), Chapter 2 (Potential Credit Allocation, 5.1/5.2/5.3 with the
 * quantity-only reconciliation gate), Chapter 3 (Actual Credit
 * Allocation, empty-state honest until a real round exists), and the
 * negative-balance protection check (Section 7.3, Option B).
 *
 * Retires the old hardcoded DEMO_AGRI_CREDITS injection entirely — real
 * test deals (is_test_data=true rows, see allocationBook/queries.ts) now
 * flow through the exact same code path as a real deal, tagged "(TEST)"
 * rather than faked in-memory.
 */
export async function runJohnAllocationReport(ctx: ToolContext): Promise<ScheduledTaskOutcome> {
  const { finishScheduledTask } = await import("../../reports/scheduledTaskReport");
  const { loadPotentialData } = await import("./allocationBook/queries");
  const { buildChapter1Table } = await import("./allocationBook/chapter1");
  const { buildChapter2 } = await import("./allocationBook/chapter2");
  const { buildChapter3 } = await import("./allocationBook/chapter3");
  const { computeAndApplyNegativeBalanceFlags } = await import("./allocationBook/negativeBalance");

  const data = await loadPotentialData();

  const { table: buyersTable, grand: buyersGrand, sawTestData } = buildChapter1Table(data);
  const chapter2 = buildChapter2(data, buyersGrand.credits, buyersGrand.value);
  const chapter3 = await buildChapter3(data);
  const balanceResult = await computeAndApplyNegativeBalanceFlags(data);

  const summaryLines = [
    `Projects: ${data.projectOrder.length}`,
    `Farms: ${[...data.byProject.values()].flat().length}`,
    `Gross Potential: ${chapter2.reconciliation.grossPotential.toLocaleString("en-US")} VCU`,
    chapter2.reconciliation.reconciled
      ? `Chapter 2 reconciliation: RECONCILED (Gross Potential = Total Net Allocation, ${chapter2.reconciliation.totalNetAllocation.toLocaleString("en-US")} VCU).`
      : `Chapter 2 reconciliation: NOT RECONCILED - discrepancy of ${Math.abs(chapter2.reconciliation.discrepancy).toFixed(2)} VCU. Manual review required.`,
    ...chapter3.bodyParagraphs,
  ];
  if (sawTestData) {
    summaryLines.push(
      "*** TEST RUN *** - one or more (TEST) rows above are real transactional records forced through before their real sale-cycle step (signature/payment) completed, per an explicit test request (2026-08-31). Included in every total.",
    );
  }
  if (balanceResult.newAlerts.length) {
    summaryLines.push("Negative-balance alerts (Section 7.3):", ...balanceResult.newAlerts.map((a) => `- ${a}`));
  }
  if (balanceResult.cleared.length) {
    summaryLines.push("Negative-balance flags cleared:", ...balanceResult.cleared.map((c) => `- ${c}`));
  }
  if (balanceResult.activeBlocks.length) {
    summaryLines.push(
      "Active deal blocks in effect (Option B - CarboNature's 20% threshold blocks both financing tracks for that project):",
      ...balanceResult.activeBlocks.map(
        (b) => `- Project ${b.projectId}: Agri Inputs ${b.blocksAgriInputs ? "BLOCKED" : "open"}, Project Funding ${b.blocksProjectFunding ? "BLOCKED" : "open"}.`,
      ),
    );
  }

  const outcome = await finishScheduledTask(ctx, {
    taskKey: TASK_KEY,
    projectId: TARGET_PROJECT_ID,
    subject: `Allocation Book - ${new Date().toISOString().slice(0, 10)}`,
    leadCaption: "Summary",
    bodyParagraphs: summaryLines,
    tables: [buyersTable, chapter2.farmsTable, chapter2.carboNatureTable, chapter2.reconciliationTable, ...chapter3.tables],
    memoryKind: "allocation_register_report",
    sendEmail: true,
    agentId: "john",
  });

  return outcome;
}
