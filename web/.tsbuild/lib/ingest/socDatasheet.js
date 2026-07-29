import { excelDate, readWorkbook } from "./xlsx.js";
/**
 * Parser for CarboNature_SOC_Datasheet_v2.0 (spec §8).
 *
 * Two rules govern this file and both are deliberate:
 *
 *  1. TOC is never taken from the sheet. Under DIN 19539 / ISO 17505 the
 *     ramped fractions are what the laboratory measures, and TOC is their
 *     sum (TOC400 + ROC600). Treating TOC400 alone as total organic carbon
 *     under-reports any soil holding char or soot — common where residue is
 *     burnt — so the sum is recomputed here.
 *  2. SOC stock is recomputed too, never trusted from column AK. The sheet's
 *     formula and the database's generated column must agree, and the only
 *     way to know they do is to compute it independently and compare.
 *
 * Anything that fails validation is quarantined with a reason rather than
 * dropped, because a silently missing row is worse than a visible bad one.
 */
/** Header row and first data row in the "Lab Results" sheet. */
const HEADER_ROW = 5;
const FIRST_DATA_ROW = 6;
/** Column letters, from the shipped workbook. */
const C = {
    no: "A",
    sampleId: "B",
    sampleType: "C",
    workOrder: "D",
    farm: "E",
    projectId: "F",
    plotId: "G",
    pointId: "H",
    stratum: "I",
    scenario: "J",
    samplingDate: "K",
    depthTop: "L",
    depthBase: "M",
    thickness: "N",
    lab: "O",
    method: "P",
    iso17025: "Q",
    analysisDate: "R",
    replicate: "S",
    bulkDensity: "T",
    smallCf: "U",
    largeCf: "V",
    dryMass: "W",
    probeArea: "X",
    soilMass: "Y",
    tc: "Z",
    toc400: "AA",
    roc600: "AB",
    tic900: "AC",
    tocSheet: "AD",
    n: "AE",
    cn: "AF",
    sand: "AG",
    silt: "AH",
    clay: "AI",
    usda: "AJ",
    socSheet: "AK",
    qc: "AL",
};
const num = (v) => {
    if (v == null || v === "")
        return null;
    const n = Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
};
const bool = (v) => {
    if (!v)
        return null;
    const s = v.trim().toLowerCase();
    if (["yes", "y", "true", "1"].includes(s))
        return true;
    if (["no", "n", "false", "0"].includes(s))
        return false;
    return null;
};
const round4 = (n) => Math.round(n * 10_000) / 10_000;
/** SOC [t/ha] = TOC[%] x BD[g/cm3] x thickness[cm] — the x100 form (§8). */
export function socStock(tocPct, bd, thicknessCm, largeCfPct = 0) {
    return round4(tocPct * bd * thicknessCm * (1 - largeCfPct / 100));
}
/** Soil mass [t/ha]: dry mass / probe area preferred, BD x thickness as fallback. */
export function soilMass(dryMassG, probeAreaCm2, bd, thicknessCm, largeCfPct = 0) {
    if (dryMassG != null && probeAreaCm2)
        return round4((dryMassG / probeAreaCm2) * 100);
    if (bd != null && thicknessCm != null)
        return round4(bd * thicknessCm * 100 * (1 - largeCfPct / 100));
    return null;
}
export function parseSocDatasheet(buf) {
    const sheets = readWorkbook(buf);
    const lab = sheets.find((s) => /lab\s*results/i.test(s.name)) ?? sheets[0];
    if (!lab)
        throw new Error("Workbook has no sheets.");
    // Confirm it is the sheet we think it is before trusting column letters.
    const header = lab.rows.find((r) => r.r === HEADER_ROW);
    if (!header || (header.cells[C.sampleId] ?? "").toLowerCase() !== "sample id") {
        throw new Error("This does not look like CarboNature_SOC_Datasheet_v2.0 — expected 'Sample ID' in column B of row 5.");
    }
    const versionRow = lab.rows.find((r) => r.r === 2);
    const datasheetVersion = versionRow?.cells["A"]?.split("·")[0]?.trim() ?? null;
    const rows = [];
    const quarantined = [];
    const plots = new Set();
    const workOrders = new Set();
    const labs = new Set();
    for (const row of lab.rows) {
        if (row.r < FIRST_DATA_ROW)
            continue;
        const c = row.cells;
        const sampleId = (c[C.sampleId] ?? "").trim().toUpperCase();
        if (!sampleId)
            continue; // blank template row
        const fail = (error) => quarantined.push({ rowIndex: row.r, raw: c, error });
        /* ---- identity ---- */
        if (!/^OFM\d{10}$/.test(sampleId)) {
            fail(`Sample ID "${sampleId}" is not OFM followed by 10 digits`);
            continue;
        }
        const typeRaw = (c[C.sampleType] ?? "soc").trim().toLowerCase();
        const sampleType = typeRaw.startsWith("tex") ? "texture" : "soc";
        const depthTop = num(c[C.depthTop]);
        const depthBase = num(c[C.depthBase]);
        const bd = num(c[C.bulkDensity]);
        const toc400 = num(c[C.toc400]);
        const roc600 = num(c[C.roc600]);
        const tic900 = num(c[C.tic900]);
        const tc = num(c[C.tc]);
        const largeCf = num(c[C.largeCf]) ?? 0;
        const sand = num(c[C.sand]);
        const silt = num(c[C.silt]);
        const clay = num(c[C.clay]);
        const warnings = [];
        /* ---- per-type validation ---- */
        if (sampleType === "soc") {
            if (depthTop == null || depthBase == null) {
                fail("SOC row is missing a depth increment (Depth Top / Depth Base)");
                continue;
            }
            if (depthBase <= depthTop) {
                fail(`Depth base ${depthBase} must exceed depth top ${depthTop}`);
                continue;
            }
            if (toc400 == null && roc600 == null) {
                fail("SOC row has neither TOC 400 nor ROC 600 — nothing to compute carbon from");
                continue;
            }
            if (bd == null) {
                fail("SOC row is missing bulk density, so no stock can be computed");
                continue;
            }
            // TC identity, mirroring the database CHECK
            if (tc != null && toc400 != null && roc600 != null && tic900 != null) {
                if (Math.abs(tc - toc400 - roc600 - tic900) > 0.1) {
                    fail(`TC ${tc} does not reconcile with TOC400 ${toc400} + ROC600 ${roc600} + TIC900 ${tic900}`);
                    continue;
                }
            }
        }
        else {
            if (sand == null || silt == null || clay == null) {
                fail("Texture row must carry sand, silt and clay");
                continue;
            }
            if (Math.abs(sand + silt + clay - 100) > 1) {
                fail(`Texture fractions sum to ${(sand + silt + clay).toFixed(1)}%, not 100%`);
                continue;
            }
        }
        /* ---- recomputation (never trust the sheet) ---- */
        const thickness = depthTop != null && depthBase != null ? depthBase - depthTop : null;
        const tocPct = toc400 == null && roc600 == null ? null : round4((toc400 ?? 0) + (roc600 ?? 0));
        const socTPerHa = sampleType === "soc" && tocPct != null && bd != null && thickness != null
            ? socStock(tocPct, bd, thickness, largeCf)
            : null;
        const sheetToc = num(c[C.tocSheet]);
        const sheetSoc = num(c[C.socSheet]);
        if (tocPct != null && sheetToc != null && Math.abs(tocPct - sheetToc) > 0.005)
            warnings.push(`Workbook TOC ${sheetToc} differs from TOC400+ROC600 = ${tocPct}`);
        if (socTPerHa != null && sheetSoc != null && Math.abs(socTPerHa - sheetSoc) > 0.05)
            warnings.push(`Workbook SOC ${sheetSoc} differs from recomputed ${socTPerHa} t/ha`);
        const dryMass = num(c[C.dryMass]);
        const probeArea = num(c[C.probeArea]);
        if (sampleType === "soc" && (dryMass == null || probeArea == null))
            warnings.push("No dry mass / probe area — ESM falls back to BD x thickness (§8.2.1.6)");
        const iso = bool(c[C.iso17025]);
        if (iso === false)
            warnings.push("Laboratory not ISO 17025 accredited (§8.2.1.4)");
        const method = c[C.method] ?? null;
        // §8.2.1.4 governs the carbon analysis. Texture is measured by hydrometer,
        // pipette or laser, so the dry-combustion rule must not be applied to it.
        if (sampleType === "soc" && method && !/dry\s*combustion|dumas/i.test(method))
            warnings.push(`Method "${method}" is not dry combustion — document the deviation (§8.2.1.4)`);
        const plotId = c[C.plotId] ?? null;
        if (plotId)
            plots.add(plotId);
        const wo = c[C.workOrder] ?? null;
        if (wo)
            workOrders.add(wo);
        const labName = c[C.lab] ?? null;
        if (labName)
            labs.add(labName);
        rows.push({
            rowIndex: row.r,
            sampleId,
            sampleType,
            workOrderId: wo,
            plotId,
            pointId: c[C.pointId] ?? null,
            stratumCode: c[C.stratum] ?? null,
            scenario: c[C.scenario] ?? null,
            samplingDate: excelDate(c[C.samplingDate]),
            analysisDate: excelDate(c[C.analysisDate]),
            lab: labName,
            method,
            iso17025: iso,
            replicateNo: num(c[C.replicate]) ?? 1,
            depthTopCm: depthTop,
            depthBaseCm: depthBase,
            bulkDensity: bd,
            smallCfPct: num(c[C.smallCf]),
            largeCfPct: num(c[C.largeCf]),
            dryMassG: dryMass,
            probeAreaCm2: probeArea,
            tcPct: tc,
            toc400Pct: toc400,
            roc600Pct: roc600,
            tic900Pct: tic900,
            nPct: num(c[C.n]),
            tocPct,
            socTPerHa,
            soilMassTHa: soilMass(dryMass, probeArea, bd, thickness, largeCf),
            sheetTocPct: sheetToc,
            sheetSocTPerHa: sheetSoc,
            sandPct: sand,
            siltPct: silt,
            clayPct: clay,
            usdaClass: c[C.usda] ?? null,
            warnings,
        });
    }
    return {
        datasheetVersion,
        rows,
        quarantined,
        summary: {
            total: rows.length,
            soc: rows.filter((r) => r.sampleType === "soc").length,
            texture: rows.filter((r) => r.sampleType === "texture").length,
            plots: [...plots],
            workOrders: [...workOrders],
            labs: [...labs],
        },
    };
}
