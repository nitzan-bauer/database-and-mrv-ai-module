import type { LiveTable, LiveRowKind } from "@/lib/agent/scheduledTasks/allocationBook/liveView";

export const ROW_CLASS: Record<LiveRowKind, string> = {
  normal: "",
  total: "bg-sage-50 font-semibold",
  grand: "bg-pine-800 text-white font-semibold",
  spacer: "h-3 bg-transparent border-none",
  section: "bg-pine-100 font-bold uppercase tracking-wide text-[13.5px] text-pine-800 border-t-2 border-pine-600",
  negative: "bg-danger/10 text-danger",
};

/**
 * Renders a LiveTable (see allocationBook/liveView.ts) with the same
 * visual language as the CarboNature Allocation Book spec mockups — a
 * teal header, sage-shaded totals, a dark-teal grand total, red for
 * negative rows, and a tinted "net" column — this time as real HTML/CSS,
 * so multi-line headers and wrapped cells work properly (the emailed PDF
 * report can't do either).
 */
export function BookTable({ table, titleExtra }: { table: LiveTable; titleExtra?: React.ReactNode }) {
  return (
    <div className="mb-8">
      {table.title ? (
        <h3 className="mb-2 flex items-center gap-3 text-[15px] font-semibold text-pine-800">
          {table.title}
          {titleExtra}
        </h3>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-line-2">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {table.headers.map((h, i) => {
                const isNet = i === table.netCol;
                const [main, sub] = Array.isArray(h) ? h : [h, null];
                return (
                  <th
                    key={i}
                    className={`px-3 py-2 text-right font-semibold text-white first:text-left ${isNet ? "bg-pine-900" : "bg-pine-600"}`}
                  >
                    <div>{main}</div>
                    {sub ? <div className="text-[11px] font-normal opacity-85">{sub}</div> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, ri) =>
              row.kind === "spacer" ? (
                <tr key={ri} aria-hidden>
                  <td colSpan={table.headers.length} className="h-3 border-none bg-transparent p-0" />
                </tr>
              ) : row.kind === "section" ? (
                // A project-name banner reads as one label spanning the
                // whole row, not "text in column 1" — confined to column
                // 1's own (narrow) width, a longer project name wrapped
                // into an ugly 3-line stack (Nitzan, 2026-08-31).
                <tr key={ri} className={`${ROW_CLASS.section} border-b border-line-2`}>
                  <td colSpan={table.headers.length} className="whitespace-nowrap px-3 py-2 text-left">
                    {row.cells[0]}
                  </td>
                </tr>
              ) : (
                <tr key={ri} className={`${ROW_CLASS[row.kind]} border-b border-line-2 last:border-0`}>
                  {row.cells.map((cell, ci) => {
                    const isNet = ci === table.netCol;
                    return (
                      <td
                        key={ci}
                        className={`whitespace-nowrap px-3 py-1.5 text-right font-mono first:text-left first:font-sans first:whitespace-normal ${
                          isNet && row.kind === "normal" ? "bg-sage-50/60 font-semibold" : ""
                        }`}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
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
    </div>
  );
}
