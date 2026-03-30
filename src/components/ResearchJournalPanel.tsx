import { useState } from "react";
import { WorkspaceResearchJournalEntry } from "../lib/researchWorkspace";

interface Props {
  entries: WorkspaceResearchJournalEntry[];
  onAdd: (entry: Omit<WorkspaceResearchJournalEntry, "id" | "recordedAt">) => void;
}

export default function ResearchJournalPanel({ entries, onAdd }: Props) {
  const [kind, setKind] = useState<WorkspaceResearchJournalEntry["kind"]>("note");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-slate-800">Research Journal</h3>
      <p className="mt-1 text-sm text-slate-500">
        Write down why you would buy, why you would not buy, and what changed. This prevents the valuation tab from becoming a black-box decision machine.
      </p>

      <div className="mt-4 grid gap-3 md:grid-cols-[180px,1fr]">
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as WorkspaceResearchJournalEntry["kind"])}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          <option value="note">Research note</option>
          <option value="buy">Buy note</option>
          <option value="sell">Sell note</option>
          <option value="review">Review note</option>
          <option value="post-mortem">Post-mortem</option>
        </select>
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title"
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        />
      </div>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="What changed? Why is the market wrong, or why might you be wrong?"
        rows={4}
        className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
      />
      <div className="mt-3 flex justify-end">
        <button
          onClick={() => {
            onAdd({ kind, title, body, relatedRunId: null });
            setTitle("");
            setBody("");
          }}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white"
        >
          Save Journal Entry
        </button>
      </div>

      <div className="mt-5 space-y-3">
        {entries.slice(0, 8).map((entry) => (
          <div key={entry.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-slate-800">{entry.title}</div>
              <div className="text-xs uppercase tracking-wide text-slate-500">{entry.kind}</div>
            </div>
            <div className="mt-1 text-xs text-slate-500">{new Date(entry.recordedAt).toLocaleString("en-IN")}</div>
            <div className="mt-2 text-sm text-slate-700">{entry.body}</div>
          </div>
        ))}
        {!entries.length && <p className="text-sm text-slate-500">No journal entries yet.</p>}
      </div>
    </div>
  );
}
