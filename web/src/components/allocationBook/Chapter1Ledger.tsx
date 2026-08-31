"use client";

import { useState } from "react";
import type { LiveTable } from "@/lib/agent/scheduledTasks/allocationBook/liveView";
import type { SaasContractDetail } from "@/lib/saas/saasClient";
import { ROW_CLASS } from "./BookTable";

const TYPE_LABEL: Record<string, string> = {
  project_financing: "Project Financing Agreement",
  funding_agri_inputs: "Agri-Inputs Funding Agreement",
  pre_financing: "Pre-Financing Agreement",
};

function ContractModal({ contract, onClose }: { contract: SaasContractDetail; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Status", contract.status === "countersigned" ? "Executed by both parties" : contract.status],
    ["Signed", contract.signedAt ? new Date(contract.signedAt).toLocaleString("en-GB") : "-"],
    ["Transaction #", contract.transactionNo ?? "-"],
    ["Total price", contract.totalPrice ?? "-"],
    ["Credit price", contract.creditPrice ?? "-"],
    ["Allocated credits", contract.allocatedCredits ?? "-"],
    ["Signed by", contract.signerName ?? "-"],
    ["Countersigned by", contract.counterSignedBy ?? "-"],
    ["Registry #", contract.registryNo ?? "-"],
  ].filter(([, v]) => v && v !== "-") as [string, string][];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-lg border border-line-2 bg-white shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between rounded-t-lg bg-pine-600 px-4 py-3">
          <h3 className="text-[14px] font-semibold text-white">{TYPE_LABEL[contract.type] ?? "Signed Agreement"}</h3>
          <button onClick={onClose} className="text-white/80 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        <dl className="space-y-2 p-4 text-[13px]">
          {rows.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-muted">{label}</dt>
              <dd className="text-right font-mono text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/**
 * Chapter 1's ledger, client-side so a Transaction # cell can open a real
 * "view signed agreement" popup (Nitzan, 2026-08-31) — pulled from the
 * live SaaS contracts table, not a mockup. Everything else (row styling,
 * section/total/grand treatment) mirrors BookTable exactly.
 */
export function Chapter1Ledger({ table, contracts }: { table: LiveTable; contracts: Record<string, SaasContractDetail> }) {
  const [openContract, setOpenContract] = useState<SaasContractDetail | null>(null);

  return (
    <div className="mb-8">
      {table.title ? <h3 className="mb-2 text-[15px] font-semibold text-pine-800">{table.title}</h3> : null}
      <div className="overflow-x-auto rounded-md border border-line-2">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {table.headers.map((h, i) => (
                <th key={i} className="bg-pine-600 px-3 py-2 text-right font-semibold text-white first:text-left">
                  {Array.isArray(h) ? h[0] : h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) => {
              if (row.kind === "spacer") {
                return (
                  <tr key={ri} aria-hidden>
                    <td colSpan={table.headers.length} className="h-3 border-none bg-transparent p-0" />
                  </tr>
                );
              }
              if (row.kind === "section") {
                return (
                  <tr key={ri} className={`${ROW_CLASS.section} border-b border-line-2`}>
                    <td colSpan={table.headers.length} className="whitespace-nowrap px-3 py-2 text-left">
                      {row.cells[0]}
                    </td>
                  </tr>
                );
              }
              const contract = row.contractKey ? contracts[row.contractKey] : undefined;
              return (
                <tr key={ri} className={`${ROW_CLASS[row.kind]} border-b border-line-2 last:border-0`}>
                  {row.cells.map((cell, ci) => {
                    const isLastCol = ci === row.cells.length - 1;
                    const clickable = isLastCol && contract;
                    return (
                      <td key={ci} className="whitespace-nowrap px-3 py-1.5 text-right font-mono first:text-left first:font-sans">
                        {clickable ? (
                          <button
                            onClick={() => setOpenContract(contract)}
                            className="text-pine-700 underline decoration-dotted underline-offset-2 hover:text-sage-600"
                          >
                            {cell}
                          </button>
                        ) : (
                          cell
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {table.notes?.length ? (
        <ul className="mt-2 space-y-1 text-[11.5px] text-muted">
          {table.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
      {openContract ? <ContractModal contract={openContract} onClose={() => setOpenContract(null)} /> : null}
    </div>
  );
}
