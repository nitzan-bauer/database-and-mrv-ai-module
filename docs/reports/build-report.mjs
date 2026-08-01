/** Assemble the TIER-1 status report, embedding the logo so the PDF is self-contained. */
import fs from "node:fs";
import path from "node:path";

const SP = path.resolve(import.meta.dirname);
const REPO = "C:/Users/nitza/OneDrive/Desktop/claude code/database-and-mrv-ai-module";
const logo = fs.readFileSync(path.join(REPO, "web/public/brand/logo-full.png")).toString("base64");
const body = fs.readFileSync(path.join(SP, "report-body.html"), "utf8");

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>CarboNature MRV — TIER-1 Status Report</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm; }
:root{
  --pine-700:#244f4f; --pine-600:#2b6161; --pine-500:#3a7570; --pine-100:#d9e8e6; --pine-50:#f0f6f5;
  --sage-700:#376a53; --sage-500:#56a37b; --sage-100:#dbf0e3;
  --gold-500:#c9a24a; --gold-200:#f1e2bb; --earth-600:#6f5339;
  --agent-700:#6d28d9; --agent-100:#f0e9fc;
  --danger:#b42318; --cream:#f6f8f6; --muted:#5b6b66; --faint:#8a9995; --line:#dfe6e3;
}
*{box-sizing:border-box}
body{margin:0;font:11pt/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#1f2d2b;-webkit-print-color-adjust:exact;print-color-adjust:exact}
h1{font-size:23pt;line-height:1.15;margin:0 0 4px;color:var(--pine-700);letter-spacing:-.4px}
h2{font-size:14pt;margin:26px 0 10px;color:var(--pine-700);padding-bottom:5px;border-bottom:2px solid var(--pine-100);break-after:avoid}
h3{font-size:11.5pt;margin:16px 0 6px;color:var(--pine-600);break-after:avoid}
p{margin:0 0 9px;max-width:64em}
a{color:var(--pine-600)}
code,.mono{font-family:"SF Mono",Consolas,"Roboto Mono",monospace;font-size:9.2pt;background:var(--pine-50);padding:1px 4px;border-radius:3px;color:var(--pine-700)}
.cover{border-bottom:3px solid var(--pine-600);padding-bottom:16px;margin-bottom:8px;display:flex;align-items:flex-start;justify-content:space-between;gap:20px}
.cover img{height:44px}
.sub{color:var(--muted);font-size:10.5pt;margin-top:6px}
.meta{font-family:"SF Mono",Consolas,monospace;font-size:8.6pt;color:var(--faint);text-align:right;line-height:1.75;white-space:nowrap}
table{width:100%;border-collapse:collapse;margin:10px 0 14px;font-size:9.6pt;break-inside:avoid}
th{background:var(--pine-50);color:var(--pine-700);text-align:left;font-weight:700;padding:7px 9px;border-bottom:2px solid var(--pine-100);font-size:8.8pt;text-transform:uppercase;letter-spacing:.04em}
td{padding:6px 9px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right;font-family:"SF Mono",Consolas,monospace}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:14px 0 6px}
.kpi{border:1px solid var(--line);border-radius:9px;padding:10px 11px;background:#fff}
.kpi .n{font-size:19pt;font-weight:700;color:var(--pine-700);line-height:1.1}
.kpi .l{font-size:8.2pt;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;margin-top:3px}
.kpi .f{font-size:8.4pt;color:var(--faint);margin-top:2px}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:8.2pt;font-weight:700;white-space:nowrap}
.ok{background:var(--sage-100);color:var(--sage-700)}
.warn{background:var(--gold-200);color:var(--earth-600)}
.bad{background:#fdecea;color:var(--danger)}
.info{background:var(--agent-100);color:var(--agent-700)}
.note{border-left:3px solid var(--pine-500);background:var(--cream);padding:9px 13px;margin:11px 0;border-radius:0 7px 7px 0;break-inside:avoid}
.note.flag{border-left-color:var(--gold-500);background:#fdfaf1}
.note.stop{border-left-color:var(--danger);background:#fdf4f3}
.note p{margin:0 0 5px;font-size:10pt}
.note p:last-child{margin:0}
.note b{color:var(--pine-700)}
ul{margin:0 0 10px;padding-left:19px}
li{margin-bottom:4px}
.pb{break-before:page}
footer{margin-top:26px;padding-top:9px;border-top:1px solid var(--line);font-size:8.4pt;color:var(--faint);display:flex;justify-content:space-between}
.lead{font-size:11.5pt;color:var(--pine-700);border-left:3px solid var(--gold-500);padding-left:13px;margin:14px 0 18px}
</style></head><body>
<div class="cover">
  <div>
    <img src="data:image/png;base64,${logo}" alt="CarboNature">
    <h1 style="margin-top:12px">TIER-1 Status Report</h1>
    <div class="sub">AI Soil Module &middot; MRV &amp; Verified Credits Factory<br>Verra VM0042 v2.2 &middot; ICVCM CCP</div>
  </div>
  <div class="meta">
    1 August 2026<br>
    CARBO-3988-DEMO<br>
    60 commits &middot; 21 Jul – 1 Aug<br>
    CI: <span style="color:#376a53">passing</span>
  </div>
</div>
${body}
<footer><span>CarboNature &middot; TIER-1 Status Report</span><span>Generated 1 August 2026 from the live system</span></footer>
</body></html>`;

fs.writeFileSync(path.join(SP, "tier1-report.html"), html);
console.log(`wrote tier1-report.html (${Math.round(html.length / 1024)} KB)`);
