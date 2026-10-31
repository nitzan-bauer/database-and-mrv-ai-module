"use client";

import { useEffect, useRef, useState } from "react";
import { extractAttachmentText } from "@/lib/agent/extractAttachmentText";
import { getOneOffJobAction, rateOneOffJobAction, startOneOffJobAction } from "@/lib/agent/oneOff/oneOffActions";
import type { OneOffJob } from "@/lib/agent/oneOff/jobStore";
import { normalizeDomains } from "@/lib/agent/oneOff/chromeAllow";

interface Attached {
  name: string;
  text: string;
  truncated: boolean;
}

const MAX_FILE_BYTES = 3 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
}

/** "Was this useful?" — the human verdict that makes the next task better (see rateOneOffJobAction). */
function FeedbackBox({ jobId, agentName }: { jobId: string; agentName: string }) {
  const [verdict, setVerdict] = useState<"corrected" | "rejected" | null>(null);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(v: "approved" | "corrected" | "rejected") {
    setSaving(true);
    setError(null);
    const res = await rateOneOffJobAction({ jobId, verdict: v, correctionText: text });
    setSaving(false);
    if (res.ok) setSaved(true);
    else setError(res.error);
  }

  if (saved) return <p className="mt-3 text-[12px] text-ok">Thanks — {agentName} will use this on the next task.</p>;
  return (
    <div className="mt-3 rounded-lg border border-line p-2.5">
      <p className="text-[11.5px] font-semibold text-muted">Was this useful? {agentName} learns from your answer.</p>
      <div className="mt-1.5 flex gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => save("approved")}
          className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[12px] font-semibold text-ok hover:bg-cream disabled:opacity-60"
        >
          Useful
        </button>
        <button
          type="button"
          onClick={() => setVerdict("corrected")}
          className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[12px] font-semibold text-earth-600 hover:bg-cream"
        >
          Needs correction
        </button>
        <button
          type="button"
          onClick={() => setVerdict("rejected")}
          className="flex-1 rounded-lg border border-line px-2 py-1.5 text-[12px] font-semibold text-danger hover:bg-cream"
        >
          Wrong
        </button>
      </div>
      {verdict && (
        <>
          <textarea
            dir="auto"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="What was wrong, or what should be done differently next time?"
            className="mt-2 w-full rounded-lg border border-line p-2 text-[12.5px] outline-none focus:border-pine-400"
          />
          <button
            type="button"
            disabled={saving || !text.trim()}
            onClick={() => save(verdict)}
            className="mt-2 w-full rounded-lg bg-pine-600 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-pine-700 disabled:opacity-60"
          >
            {saving ? "Saving…" : `Send to ${agentName}`}
          </button>
        </>
      )}
      {error && <p className="mt-1.5 text-[11.5px] text-danger">{error}</p>}
    </div>
  );
}

/**
 * The body of the "One Off Task" popup, identical for all five agents: a prompt in Hebrew or English, attached
 * files, links, optionally the signed-in sites the agent may read through its own Chrome — then live progress,
 * the answer, and a verdict box that feeds the agent's learning.
 */
export function OneOffTaskForm({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [linkInput, setLinkInput] = useState("");
  const [links, setLinks] = useState<string[]>([]);
  const [siteInput, setSiteInput] = useState("");
  const [sites, setSites] = useState<string[]>([]);
  const [files, setFiles] = useState<Attached[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [job, setJob] = useState<OneOffJob | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Poll every 4 s until the job leaves queued/running.
  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      const j = await getOneOffJobAction(jobId!).catch(() => null);
      if (stop) return;
      if (j) setJob(j);
      if (!j || j.status === "queued" || j.status === "running") timer = setTimeout(tick, 4000);
    }
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = "";
    setFileError(null);
    setReading(true);
    try {
      for (const f of picked) {
        // A server action body is capped (next.config.ts, and 4.5 MB on Vercel); base64 adds a third on top.
        if (f.size > MAX_FILE_BYTES) {
          setFileError(`"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is 3 MB per file. Split it or paste the relevant part into the prompt.`);
          continue;
        }
        const res = await extractAttachmentText({ name: f.name, base64: await fileToBase64(f) });
        if (res.ok) setFiles((cur) => [...cur, { name: f.name, text: res.data.text, truncated: res.data.truncated }]);
        else setFileError(res.error);
      }
    } catch (err) {
      setFileError(`Could not read the file: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReading(false);
    }
  }

  function addLink() {
    const v = linkInput.trim();
    if (!v) return;
    setLinks((cur) => (cur.includes(v) ? cur : [...cur, v]));
    setLinkInput("");
  }

  function addSite() {
    const [d] = normalizeDomains([siteInput]);
    if (!d) return;
    setSites((cur) => (cur.includes(d) ? cur : [...cur, d]));
    setSiteInput("");
  }

  async function submit() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await startOneOffJobAction({ agentId, prompt, links, attachments: files, chromeDomains: sites });
      if (res.ok) {
        setNotes(res.notes);
        setJobId(res.jobId);
      } else {
        setStartError(res.error);
      }
    } finally {
      setStarting(false);
    }
  }

  const running = Boolean(jobId) && (!job || job.status === "queued" || job.status === "running");
  const finished = job && !running;

  return (
    <div className="p-4">
      {!jobId && (
        <>
          <p className="mb-1.5 text-[12.5px] text-muted">What should {agentName} do? (Hebrew or English)</p>
          <textarea
            dir="auto"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            autoFocus
            className="w-full rounded-lg border border-line p-2.5 text-[13px] text-ink outline-none focus:border-pine-400"
          />

          <div className="mt-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.csv,.tsv,.json,.md,.log,.yaml,.yml,.docx,.xlsx,.pdf"
              className="hidden"
              onChange={onFiles}
            />
            <button
              type="button"
              disabled={reading}
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-muted hover:border-pine-300 hover:text-pine-700 disabled:opacity-50"
            >
              {reading ? "Reading…" : "Attach files"}
            </button>
            {files.map((f) => (
              <span
                key={f.name}
                className="ml-2 inline-flex items-center gap-1 rounded-full bg-pine-50 px-2.5 py-1 text-[11px] text-pine-700"
              >
                <span className="max-w-[140px] truncate">{f.name}</span>
                {f.truncated && <span>(truncated)</span>}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((c) => c.filter((x) => x !== f))}>
                  ×
                </button>
              </span>
            ))}
            {fileError && <p className="mt-1 text-[11px] text-danger">{fileError}</p>}
          </div>

          <div className="mt-3 flex gap-2">
            <input
              type="url"
              dir="ltr"
              value={linkInput}
              onChange={(e) => setLinkInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
              placeholder="https://… (press Enter to add a link)"
              className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-[12.5px] outline-none focus:border-pine-400"
            />
            <button
              type="button"
              onClick={addLink}
              className="rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-muted hover:bg-cream"
            >
              Add
            </button>
          </div>
          {links.map((l) => (
            <p key={l} dir="ltr" className="mt-1 flex items-center justify-between gap-2 rounded bg-cream px-2 py-1 font-mono text-[11px] text-ink">
              <span className="truncate">{l}</span>
              <button type="button" aria-label={`Remove ${l}`} onClick={() => setLinks((c) => c.filter((x) => x !== l))}>
                ×
              </button>
            </p>
          ))}

          <div className="mt-4 rounded-lg border border-line bg-[#fafcfb] p-2.5">
            <p className="text-[11.5px] font-semibold text-pine-700">Signed-in sites {agentName} may read in its own Chrome</p>
            <p className="mt-0.5 text-[11px] text-faint">
              Read-only — only the sites listed here, for this task. Works while your PC and {agentName}&apos;s Chrome are
              running; otherwise {agentName} uses public pages and says what it could not read.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                dir="ltr"
                value={siteInput}
                onChange={(e) => setSiteInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSite();
                  }
                }}
                placeholder="example.org"
                className="min-w-0 flex-1 rounded-lg border border-line px-3 py-1.5 text-[12.5px] outline-none focus:border-pine-400"
              />
              <button
                type="button"
                onClick={addSite}
                className="rounded-lg border border-line bg-white px-3 text-[12.5px] font-semibold text-muted hover:bg-cream"
              >
                Add
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sites.map((d) => (
                <span key={d} dir="ltr" className="inline-flex items-center gap-1 rounded-full bg-pine-50 px-2.5 py-1 font-mono text-[11px] text-pine-700">
                  {d}
                  <button type="button" aria-label={`Remove ${d}`} onClick={() => setSites((c) => c.filter((x) => x !== d))}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {startError && <p className="mt-2 text-[12px] text-danger">{startError}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] font-semibold text-muted hover:bg-cream"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!prompt.trim() || starting || reading}
              className="flex-[2] rounded-lg bg-pine-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-pine-700 disabled:opacity-60"
            >
              {starting ? "Starting…" : `Run ${agentName}`}
            </button>
          </div>
        </>
      )}

      {jobId && (
        <div>
          {notes.map((n) => (
            <p key={n} className="mb-1 text-[11.5px] text-earth-600">
              {n}
            </p>
          ))}
          <p className="text-[12.5px] font-semibold text-pine-700">
            {running
              ? `${agentName} is working… you can close this window; the report will arrive by email.`
              : job?.status === "done"
                ? "Done"
                : job?.status === "needs_approval"
                  ? "Waiting for approval"
                  : "Failed"}
          </p>
          <ol className="mt-2 space-y-1">
            {(job?.progress ?? []).map((p) => (
              <li key={`${p.step}-${p.tool}`} className="text-[11.5px] text-muted">
                {p.step}. {p.tool ? <span className="font-mono">{p.tool}</span> : "answer"} — {p.summary}
              </li>
            ))}
          </ol>
          {finished && (
            <div
              dir="auto"
              className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-cream p-3 text-[12.5px] leading-relaxed text-ink"
            >
              {job.resultText ?? job.error}
            </div>
          )}
          {finished && job.status === "done" && <FeedbackBox jobId={job.jobId} agentName={agentName} />}
          {finished && (
            <button
              type="button"
              onClick={onClose}
              className="mt-3 w-full rounded-lg bg-pine-600 px-3 py-2 text-[12.5px] font-semibold text-white hover:bg-pine-700"
            >
              Close
            </button>
          )}
        </div>
      )}
    </div>
  );
}
