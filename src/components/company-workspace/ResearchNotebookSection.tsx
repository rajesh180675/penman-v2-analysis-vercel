import { ResearchNotebook } from "../../lib/researchWorkspace";
import { NoteField, SelectField, TextField } from "./fields";
import { toTextAreaValue } from "./CompanyWorkspace.formatters";

interface Props {
  currentNotebook: ResearchNotebook;
  onNotebookFieldChange: <K extends keyof ResearchNotebook>(key: K, value: ResearchNotebook[K]) => void;
}

export default function ResearchNotebookSection({ currentNotebook, onNotebookFieldChange }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-slate-800">Research Notebook</h3>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <NoteField label="Business Summary" value={toTextAreaValue(currentNotebook.businessSummary)} onChange={(value) => onNotebookFieldChange("businessSummary", value)} />
        <NoteField label="Investment Thesis" value={toTextAreaValue(currentNotebook.thesis)} onChange={(value) => onNotebookFieldChange("thesis", value)} />
        <NoteField label="Variant View" value={toTextAreaValue(currentNotebook.variantView)} onChange={(value) => onNotebookFieldChange("variantView", value)} />
        <NoteField label="Key Drivers" value={toTextAreaValue(currentNotebook.keyDrivers)} onChange={(value) => onNotebookFieldChange("keyDrivers", value)} />
        <NoteField label="Catalysts" value={toTextAreaValue(currentNotebook.catalysts)} onChange={(value) => onNotebookFieldChange("catalysts", value)} />
        <NoteField label="Risks" value={toTextAreaValue(currentNotebook.risks)} onChange={(value) => onNotebookFieldChange("risks", value)} />
        <NoteField label="What Must Go Right" value={toTextAreaValue(currentNotebook.whatMustGoRight)} onChange={(value) => onNotebookFieldChange("whatMustGoRight", value)} />
        <NoteField label="What Breaks The Thesis" value={toTextAreaValue(currentNotebook.whatBreaksThesis)} onChange={(value) => onNotebookFieldChange("whatBreaksThesis", value)} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <SelectField
          label="Watch Level"
          value={currentNotebook.watchLevel}
          options={[
            { value: "watch", label: "Watch" },
            { value: "researching", label: "Researching" },
            { value: "accumulate", label: "Accumulate" },
            { value: "high-conviction", label: "High conviction" },
          ]}
          onChange={(value) => onNotebookFieldChange("watchLevel", value as ResearchNotebook["watchLevel"])}
        />
        <TextField label="Position Plan" value={currentNotebook.positionPlan} onChange={(value) => onNotebookFieldChange("positionPlan", value)} />
        <TextField label="Next Check" value={currentNotebook.nextCheck} onChange={(value) => onNotebookFieldChange("nextCheck", value)} />
      </div>
      <div className="mt-3 text-xs text-slate-500">
        Notebook updated: {currentNotebook.updatedAt ? new Date(currentNotebook.updatedAt).toLocaleString("en-IN") : "not yet"}
      </div>
    </div>
  );
}
