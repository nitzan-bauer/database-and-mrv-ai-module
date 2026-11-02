/**
 * VM0042 v2.2 §8.5 — allocation of leakage between emission reductions and
 * removals (eq 39 and eq 42), as amended by Corrections and Clarifications
 * of 11 Jun 2026 (Correction 3):
 *
 *   LK_ER,t = (LE_OA,t + LK_disp,t + LE_BR,t) × ER_t / (ER_t + CR_t)    (39)
 *   LK_CR,t = (LE_OA,t + LK_disp,t + LE_BR,t) × CR_t / (ER_t + CR_t)    (42)
 *
 * LK_disp,t (leakage from displaced production, §8.4.3, eq 36) was left out
 * of the sum before the correction. All three leakage sources are pooled and
 * then split in proportion to reductions and removals — none is tied to one
 * side. Pure and dependency-free so it can be unit-tested directly.
 */
export interface LeakageInputs {
  /** ER_t — reductions in the year, tCO2e. */
  er: number;
  /** CR_t — removals in the year, tCO2e (0 when there is no SOC/QA1 removals pathway). */
  cr: number;
  /** LE_OA,t — §8.4.1 new organic amendments (eq 33). */
  leOa: number;
  /** LK_disp,t — §8.4.3 displaced production (eq 36). */
  lkDisp: number;
  /** LE_BR,t — §8.4.4 diversion of biomass residues from energy. */
  leBr: number;
}

export interface LeakageAllocation {
  /** Sum of the three leakage sources before allocation. */
  total: number;
  /** LK_ER,t — leakage allocated to reductions. */
  lkEr: number;
  /** LK_CR,t — leakage allocated to removals. */
  lkCr: number;
}

export function allocateLeakage({ er, cr, leOa, lkDisp, leBr }: LeakageInputs): LeakageAllocation {
  const total = leOa + lkDisp + leBr;
  const denom = er + cr;
  // With no reductions and no removals the ratio is undefined; charging it all
  // to reductions is the conservative reading (it cannot understate leakage).
  if (!(denom > 0)) return { total, lkEr: total, lkCr: 0 };
  return { total, lkEr: (total * er) / denom, lkCr: (total * cr) / denom };
}
