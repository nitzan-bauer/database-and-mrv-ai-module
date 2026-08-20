/**
 * VM0042 v2.2 Appendix 1 ("Non-exhaustive list of potential improved ALM
 * practices that could constitute the project activity", pp.140-142) —
 * transcribed verbatim from docs/source/VM0042v2.2.txt (repo root), the
 * real methodology text CarboNature holds a local copy of. One entry per
 * mrv.activity_type value, so a real mrv.alm_activities row can be linked
 * to the exact category and bullet that covers it, for eligibility
 * evidence (Applicability Condition 1) and additionality (Step 3 Common
 * Practice) — both of which Appendix 1 itself says this list serves.
 *
 * 'other' has no entry: Appendix 1 is explicitly non-exhaustive, so an
 * activity typed 'other' needs a person to point at the specific bullet
 * (or argue a genuinely new practice) rather than have one guessed here.
 */
export interface Vm0042EligibilityReference {
  activityType: string;
  category: string;
  bullet: string;
  citation: string;
}

export const VM0042_APPENDIX1_CITATION = "VM0042 v2.2, Appendix 1: Non-exhaustive list of potential improved ALM practices";

export const VM0042_ELIGIBILITY_REFERENCE: Record<string, Vm0042EligibilityReference> = {
  biofertilizer: {
    activityType: "biofertilizer",
    category: "Improve crop planting and harvesting",
    bullet: "Incorporation of fungal/microbial inoculants or other soil probiotics",
    citation: `${VM0042_APPENDIX1_CITATION}, p.141`,
  },
  crf: {
    activityType: "crf",
    category: "Improve fertilizer (organic or inorganic) application",
    bullet:
      "Enhanced efficiency nitrogen fertilizers (e.g., urease/nitrification inhibitors, controlled release fertilizers)",
    citation: `${VM0042_APPENDIX1_CITATION}, p.140-141`,
  },
  cover_crop: {
    activityType: "cover_crop",
    category: "Improve crop planting and harvesting",
    bullet:
      "Continuous commercial crop with cover crop / Rotational commercial crop with cover crop / " +
      "Intercropping of cover crop with commercial crop during the same growing season",
    citation: `${VM0042_APPENDIX1_CITATION}, p.141`,
  },
  reduced_tillage: {
    activityType: "reduced_tillage",
    category: "Reduce tillage/improve residue management",
    bullet: "Reduced tillage/conservation tillage / Strip-till/mulch-till / No-till",
    citation: `${VM0042_APPENDIX1_CITATION}, p.141`,
  },
  residue: {
    activityType: "residue",
    category: "Reduce tillage/improve residue management",
    bullet: "Crop residue retention / Avoidance of residue burning",
    citation: `${VM0042_APPENDIX1_CITATION}, p.141`,
  },
  irrigation: {
    activityType: "irrigation",
    category: "Improve water management/irrigation",
    bullet:
      "Alteration of irrigation (e.g., precision irrigation) / Alternate wetting and drying (AWD) in rice systems / " +
      "Groundwater level management",
    citation: `${VM0042_APPENDIX1_CITATION}, p.141`,
  },
};

/** VM0042 v2.2 §3 Definitions is on p.9 of the local copy — cited alongside Appendix 1, not a substitute for it. */
export const VM0042_DEFINITIONS_CITATION = "VM0042 v2.2, §3 Definitions, p.9";
