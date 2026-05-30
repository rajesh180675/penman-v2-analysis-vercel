export function Mini({ title, value }: { title: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-lg p-2 bg-slate-50">
      <div className="text-[11px] text-slate-500 uppercase">{title}</div>
      <div className="font-semibold text-slate-800">{value}</div>
    </div>
  );
}
