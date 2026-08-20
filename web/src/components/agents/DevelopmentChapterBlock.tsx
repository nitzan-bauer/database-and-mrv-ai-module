"use client";

import { useState } from "react";
import { DevelopmentSectionCard, type GhgTableRowView } from "./DevelopmentSectionCard";
import type { PddSectionStatusRow } from "@/lib/pdd/sectionStatus";
import type { ToolResult } from "@/lib/tools/context";
import type { UpdatedPddSectionStatus } from "@/lib/tools/updatePddSectionStatus";

type UpdateAction = (input: {
  projectId: string;
  templateId: string;
  sectionIndex: number;
  status?: "pending" | "answered" | "skipped";
  inputText?: string;
  reviewComment?: string;
  devApproved?: boolean;
}) => Promise<ToolResult<UpdatedPddSectionStatus>>;

/** One chapter — a dropdown whose title is the chapter name, opening to its sections' 4-window review cards. */
export function DevelopmentChapterBlock({
  projectId,
  templateId,
  chapterNumber,
  chapterTitle,
  sections,
  sectionNumbers,
  missingInputsBySection,
  ghgTableBySection,
  action,
  defaultOpen = false,
}: {
  projectId: string;
  templateId: string;
  chapterNumber?: string;
  chapterTitle: string;
  sections: PddSectionStatusRow[];
  sectionNumbers?: Record<number, string>;
  missingInputsBySection: Record<number, string[]>;
  ghgTableBySection?: Record<number, GhgTableRowView[]>;
  action: UpdateAction;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const closedCount = sections.filter((s) => s.devApproved && (missingInputsBySection[s.sectionIndex]?.length ?? 0) === 0).length;

  return (
    <div className="rounded-xl border-2 border-pine-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-xl bg-pine-50/60 px-4 py-3 text-left hover:bg-pine-50"
      >
        <span className="text-[14px] font-bold text-pine-700">
          {chapterNumber && <span className="mr-1.5 font-mono text-faint">{chapterNumber}.</span>}
          {chapterTitle}
        </span>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-faint">
            {closedCount}/{sections.length} closed
          </span>
          <span className="text-[15px] text-pine-600">{open ? "▾" : "▸"}</span>
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line p-3">
          {sections.map((s) => (
            <DevelopmentSectionCard
              key={s.statusId}
              projectId={projectId}
              templateId={templateId}
              sectionIndex={s.sectionIndex}
              sectionNumber={sectionNumbers?.[s.sectionIndex]}
              sectionTitle={s.sectionTitle}
              guidance={s.guidance}
              draftedText={s.draftedText}
              inputText={s.inputText}
              missingInputs={missingInputsBySection[s.sectionIndex] ?? []}
              reviewComment={s.reviewComment}
              devApproved={s.devApproved}
              ghgTable={ghgTableBySection?.[s.sectionIndex]}
              action={action}
            />
          ))}
        </div>
      )}
    </div>
  );
}
