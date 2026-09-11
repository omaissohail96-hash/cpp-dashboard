"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getKpiStatus, KPI_TARGETS, KpiTarget, KpiTargetDirection } from "../lib/kpiTargets";

const API = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
let targetPromptShown = false;
const tablePriority = ["Film", "Group", "RM Input", "Line Production", "Line Waste", "Line waste%", "Rejection", "Conversion Waste", "Overall CPP waste", "Overall CPP waste %"];
type Kpi = { label: string; value: number; unit: string };
type Data = { source_sheets: string[]; total: number; columns: string[]; rows: Record<string, unknown>[]; summary?: Record<string, number> };
type KpiDetail = { label: string; field: string; unit: string };
const kpiFields: [string, string, string][] = [["RM Input", "RM Input", "kg"], ["Line Production", "Line Production", "kg"], ["Line Waste", "Line Waste", "kg"], ["Overall CPP Waste", "Overall CPP waste", "kg"], ["Overall CPP Waste %", "Overall CPP waste %", "%"], ["Transparent/Metallize Stock Opening", "Transparent/ Metallizable Stock Opening", "kg"], ["Transparent/Metallize Stock Closing", "Transparent/ Metallizable Stock Closing", "kg"], ["Metallizer Input", "Metallizer Input", "kg"], ["Metallized Stock Opening", "Metallized Stock Opening", "kg"], ["Metallized Stock Closing", "Metallized Stock Closing", "kg"], ["PS Input", "PS Input", "kg"], ["PS Production", "PS Production", "kg"], ["Rejection", "Rejection", "kg"], ["Rejection Rate", "Rejection Rate", "%"]];

function summarizeRows(rows: Record<string, unknown>[]) {
  const totals: Record<string, number> = {};
  kpiFields.forEach(([, field]) => { if (!["Overall CPP waste %", "Rejection Rate"].includes(field)) totals[field] = rows.reduce((sum, row) => sum + (typeof row[field] === "number" ? row[field] as number : 0), 0); });
  totals["Overall CPP waste %"] = totals["RM Input"] ? totals["Overall CPP waste"] / totals["RM Input"] : 0;
  totals["Rejection Rate"] = totals["Line Production"] ? totals["Rejection"] / totals["Line Production"] : 0;
  return totals;
}

function format(value: unknown, unit = "", displayUnit: "kg" | "tons" = "kg") {
  if (value === null || value === undefined || value === "") return "-";

  const normalized = (input: number) => {
    const fixed = Number.parseFloat(input.toFixed(15));
    return Number.isFinite(fixed) ? fixed : input;
  };

  if (typeof value !== "number") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      if (unit !== "%") {
        const converted = numeric / (displayUnit === "tons" ? 1000 : 1);
        return converted.toLocaleString(undefined, { maximumFractionDigits: displayUnit === "tons" ? 3 : 0 });
      }
      const clean = normalized(numeric);
      return clean.toLocaleString(undefined, { maximumFractionDigits: 15 }).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
    }
    return String(value);
  }

  // Excel displays percentage cells as a percentage, typically with two decimals.
  const numeric = unit === "%" ? Number((value * 100).toFixed(2)) : Number((value / (displayUnit === "tons" ? 1000 : 1)).toFixed(displayUnit === "tons" ? 3 : 0));
  const clean = unit === "%" ? numeric : normalized(numeric);
  return clean.toLocaleString(undefined, { maximumFractionDigits: unit === "%" ? 2 : displayUnit === "tons" ? 3 : 0 }).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

export default function Dashboard({ onUploadNew }: { onUploadNew?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [hasLoadedData, setHasLoadedData] = useState(false);
  const [displayUnit, setDisplayUnit] = useState<"kg" | "tons">("tons");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reportingPeriod, setReportingPeriod] = useState("");
  const [uploadedDate, setUploadedDate] = useState("");
  const [uploaderName, setUploaderName] = useState("");
  const [modalKpi, setModalKpi] = useState<KpiDetail | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [targets, setTargets] = useState<Record<string, KpiTarget>>(() => Object.fromEntries(Object.entries(KPI_TARGETS).map(([label, value]) => [label, { ...value }])));
  const [targetsLoaded, setTargetsLoaded] = useState(false);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") setModalKpi(null); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem("cpp-waste-kpi-targets") || "null") as Record<string, KpiTarget> | null;
      if (saved) setTargets(current => ({ ...current, ...saved }));
    } catch { /* Ignore malformed browser settings and keep defaults. */ }
    finally { setTargetsLoaded(true); }
  }, []);
  useEffect(() => {
    if (targetsLoaded) window.localStorage.setItem("cpp-waste-kpi-targets", JSON.stringify(targets));
  }, [targets, targetsLoaded]);
  useEffect(() => { window.localStorage.setItem("cpp-waste-kpi-targets", JSON.stringify(targets)); }, [targets]);

  const fetchTable = async (query = search, chosen = selected) => {
    const values = Object.entries(chosen).filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join("|");
    const params = new URLSearchParams({ limit: "150" });
    if (query) params.set("search", query);
    if (values) params.set("filters", values);
    const [detailResponse, filterResponse] = await Promise.all([
      fetch(`${API}/api/sections/waste?${params}`),
      fetch(`${API}/api/sections/waste/filters`),
    ]);
    if (!detailResponse.ok || !filterResponse.ok) throw new Error("Could not load the Waste sheet.");
    const detail = await detailResponse.json();
    setData(detail);
    const filteredTotals = summarizeRows(detail.rows || []);
    setKpis(kpiFields.map(([label, field, unit]) => ({ label, value: filteredTotals[field] || 0, unit })));
    setFilters((await filterResponse.json()).filters || {});
  };

  const load = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/api/overview`);
      if (!response.ok) throw new Error("The Waste dashboard API is unavailable.");
      const overview = await response.json();
      setReportingPeriod(overview.reporting_period || ""); setUploadedDate(overview.uploaded_date || ""); setUploaderName(overview.uploader_name || "");
      setKpis(overview.kpis || []);
      setHasLoadedData(Boolean(overview.loaded_at));
      await fetchTable();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Loading failed."); }
    finally { setBusy(false); }
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (hasLoadedData) fetchTable().catch(cause => setError(cause.message)); }, [selected, hasLoadedData]);

  const chart = useMemo(() => {
    const ranked = (data?.rows || []).map(row => ({ name: String(row.Film || "Unspecified").slice(0, 24), value: Number(row["Line Waste"] || 0) / (displayUnit === "tons" ? 1000 : 1) })).filter(item => item.value > 0).sort((a, b) => b.value - a.value).slice(0, 8);
    const total = ranked.reduce((sum, item) => sum + item.value, 0);
    let running = 0;
    return ranked.map(item => { running += item.value; return { ...item, cumulative: total ? Number((running / total * 100).toFixed(1)) : 0 }; });
  }, [data, displayUnit]);
  const columns = tablePriority.filter(column => data?.columns.includes(column));
  const activeFilters = Object.entries(selected).filter(([, value]) => value).length;
  const filmFilter = Object.entries(selected).find(([key, value]) => key.toLowerCase() === "film" && value);
  const clearFilters = () => { setSelected({}); setSearch(""); };

  return <main data-film-filtered={filmFilter ? "true" : "false"} className="waste-shell min-h-screen text-slate-900">
    <header className="border-b border-white/10 bg-slate-950 text-white"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
      <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-teal-400 text-lg font-black text-slate-950">M</div><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-teal-300">Operations control</p><h1 className="mt-0.5 text-lg font-bold">CPP Dashboard</h1></div></div>
      <div className="flex items-center gap-2"><button type="button" onClick={() => setTargetsOpen(current => !current)} className="rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20">Targets</button><label className="flex items-center gap-2 text-xs font-semibold text-slate-200">Display<select value={displayUnit} onChange={event => setDisplayUnit(event.target.value as "kg" | "tons")} className="rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-xs text-white"><option value="kg" className="text-slate-900">Kg</option><option value="tons" className="text-slate-900">Tons</option></select></label></div>
      <div className="pointer-events-none absolute left-1/2 hidden -translate-x-1/2 text-center md:block"><p className="text-sm font-semibold text-slate-200">Uploaded by: {uploaderName || "No file uploaded"}</p><p className="text-xs font-bold text-slate-400">{uploadedDate ? uploadedDate.split("-").reverse().join(".") : ""}</p></div></div></header>

      {onUploadNew && <div className="mx-auto max-w-7xl px-5 pt-4 sm:px-8"><button type="button" onClick={onUploadNew} className="rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs font-semibold text-teal-800 shadow-sm hover:bg-teal-50">Upload new file</button></div>}
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8">
      <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-teal-800 via-teal-700 to-cyan-700 px-6 py-7 text-white shadow-xl shadow-teal-950/15 sm:px-8"><div className="flex flex-wrap items-start gap-5"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-teal-100">Waste tab only</p><h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Waste performance, made actionable.</h2><p className="mt-2 max-w-xl text-sm leading-6 text-teal-50">Film-wise analysis from the uploaded workbook. The workbook remains read-only.</p></div></div></section>

      {error && <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><span>{error}</span><button onClick={load} className="font-bold underline">Try again</button></div>}
      {reportingPeriod && <div className="mt-5 rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm font-semibold text-teal-900">Showing data for {new Date(`${reportingPeriod}-01T00:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" })}{uploadedDate ? ` (uploaded: ${uploadedDate.split("-").reverse().join(".")})` : ""}</div>}

      {targetsOpen && <TargetSettings targets={targets} displayUnit={displayUnit} onChange={(label, patch) => setTargets(current => ({ ...current, [label]: { ...current[label], ...patch } }))} onReset={() => setTargets(Object.fromEntries(Object.entries(KPI_TARGETS).map(([label, value]) => [label, { ...value }])))} />}

      <section className="-mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{kpis.map((kpi, index) => {
        const status = getKpiStatus(kpi.label, kpi.value, targets);
        const statusClass = status === "safe" ? "kpi-safe" : status === "unsafe" ? "kpi-unsafe" : index === 2 ? "kpi-primary" : "";
        const statusLabel = status === "safe" ? "On target" : status === "unsafe" ? "Above target" : "No target";
        return <button type="button" disabled={Boolean(filmFilter)} onClick={() => { if (!filmFilter) setModalKpi({ label: kpi.label, field: kpiFields.find(item => item[0] === kpi.label)?.[1] || kpi.label, unit: kpi.unit }); }} key={kpi.label} className={`kpi-card text-left transition hover:-translate-y-0.5 hover:shadow-lg ${statusClass} ${filmFilter ? "cursor-default" : ""}`} aria-label={`${kpi.label}: ${format(kpi.value, kpi.unit, displayUnit)} ${statusLabel}`}><div className="flex items-center justify-between"><p>{kpi.label}</p><span className="h-1.5 w-1.5 rounded-full bg-current opacity-40"/></div><strong>{format(kpi.value, kpi.unit, displayUnit)}<small>{kpi.unit === "%" ? "%" : displayUnit === "tons" ? "tons" : "kg"}</small></strong><span className={`mt-2 block text-[10px] font-semibold ${status === "safe" ? "text-emerald-700" : status === "unsafe" ? "text-rose-700" : "text-slate-500"}`}>{filmFilter ? "Filtered summary" : `${statusLabel} · Click for breakdown`}</span></button>;
      })}</section>

      <section className="panel mt-7 overflow-hidden"><div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 p-5 sm:p-6"><div><p className="section-kicker">Explore the report</p><h3 className="mt-1 text-lg font-bold">Film-wise Waste</h3><p className="mt-1 text-sm text-slate-500">{data?.total ?? 0} films shown</p></div><form onSubmit={event => { event.preventDefault(); fetchTable().catch(cause => setError(cause.message)); }} className="flex w-full gap-2 sm:w-auto"><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search a film or group" className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm sm:w-64"/><button className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-white">Search</button></form></div>
        <div className="flex flex-wrap items-end gap-3 bg-slate-50/80 p-4 sm:px-6">{Object.entries(filters).map(([column, values]) => <label key={column} className="min-w-44 flex-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{column}<select value={selected[column] || ""} onChange={event => setSelected(current => ({ ...current, [column]: event.target.value }))} className="mt-1.5 block w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium normal-case tracking-normal text-slate-700"><option value="">All values</option>{values.map(value => <option key={value} value={value}>{value}</option>)}</select></label>)}<button onClick={clearFilters} disabled={!search && !activeFilters} className="rounded-xl px-3 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:text-slate-400">Clear filters</button></div>
      </section>

      <div className="mt-7 grid gap-6 xl:grid-cols-5"><section className="panel p-5 sm:p-6 xl:col-span-2"><div className="flex items-start justify-between"><div><p className="section-kicker">Priority analysis</p><h3 className="mt-1 font-bold">Waste Pareto by Film</h3><p className="mt-1 text-xs text-slate-500">Bars rank waste; line shows cumulative share.</p></div><span className="rounded-lg bg-teal-50 px-2.5 py-1 text-xs font-bold text-teal-700">kg / %</span></div><div className="mt-5 h-80">{chart.length ? <ResponsiveContainer><ComposedChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 42 }}><CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3"/><XAxis dataKey="name" angle={-28} textAnchor="end" height={65} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#475569" }}/><YAxis yAxisId="waste" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#64748b" }}/><YAxis yAxisId="share" orientation="right" domain={[0, 100]} tickFormatter={(value) => `${value}%`} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#0f766e" }}/><Tooltip formatter={(value: number, name: string) => [name === "cumulative" ? `${value}%` : `${format(value)} kg`, name === "cumulative" ? "Cumulative share" : "Line Waste"]} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0" }}/><Bar yAxisId="waste" dataKey="value" fill="#0f766e" radius={[6, 6, 0, 0]} barSize={25}/><Line yAxisId="share" type="monotone" dataKey="cumulative" stroke="#f59e0b" strokeWidth={3} dot={{ r: 3, fill: "#f59e0b" }}/></ComposedChart></ResponsiveContainer> : <div className="grid h-full place-items-center rounded-xl bg-slate-50 text-sm text-slate-400">No line-waste values match the current filters.</div>}</div></section>
      <section className="panel min-w-0 overflow-hidden xl:col-span-3"><div className="flex items-center justify-between border-b border-slate-100 px-5 py-5 sm:px-6"><div><p className="section-kicker">Report details</p><h3 className="mt-1 font-bold">Waste by film</h3></div><span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600">{data?.total ?? 0} records</span></div><div className="max-h-[410px] overflow-auto"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500"><tr>{columns.map(column => <th key={column} className="whitespace-nowrap px-4 py-3.5 font-bold">{column}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{data?.rows.map((row, index) => <tr key={index} className="transition hover:bg-teal-50/60">{columns.map(column => <td key={column} title={format(row[column])} className={`max-w-48 truncate whitespace-nowrap px-4 py-3.5 ${column === "Film" ? "font-semibold text-slate-800" : "text-slate-600"}`}>{format(row[column], column.includes("%") ? "%" : "")}{column.includes("%") && row[column] != null ? "%" : ""}</td>)}</tr>)}{!data?.rows.length && <tr><td colSpan={columns.length || 1} className="px-4 py-24 text-center text-sm text-slate-400">No films match the current filters.</td></tr>}</tbody></table></div></section></div>
    </div>
    {modalKpi && <KpiDetailModal kpi={modalKpi} rows={data?.rows || []} displayUnit={displayUnit} onClose={() => setModalKpi(null)} />}
  </main>;
}

function TargetSettings({ targets, displayUnit, onChange, onReset }: { targets: Record<string, KpiTarget>; displayUnit: "kg" | "tons"; onChange: (label: string, patch: Partial<KpiTarget>) => void; onReset: () => void }) {
  const [authorized, setAuthorized] = useState(false);
  const prompted = useRef(false);
  useEffect(() => { if (prompted.current || targetPromptShown) return; prompted.current = true; targetPromptShown = true; const passkey = window.prompt("Enter passkey to edit KPI targets:"); if (passkey === "1234") setAuthorized(true); else window.alert("Incorrect passkey."); }, []);
  if (!authorized) return null;
  return <section className="panel mt-5 overflow-hidden border-teal-100">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-teal-50/60 px-5 py-4">
      <div><p className="section-kicker">Performance thresholds</p><h3 className="mt-1 font-bold">Set KPI targets</h3><p className="mt-1 text-xs text-slate-500">Targets are saved in this browser. Weight targets follow the selected display unit; percentage targets use %.</p></div>
      <button type="button" onClick={onReset} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Reset defaults</button>
    </div>
    <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(targets).map(([label, config]) => {
      const percentage = label.includes("%") || label === "Rejection Rate";
      const shownTarget = percentage ? Number((config.target * 100).toFixed(4)) : Number((config.target / (displayUnit === "tons" ? 1000 : 1)).toFixed(4));
      return <div key={label} className="rounded-xl border border-slate-200 bg-white p-3"><label className="block text-[11px] font-bold uppercase tracking-wide text-slate-600">{label}</label><div className="mt-2 flex gap-2"><input type="number" min="0" step={percentage ? "0.01" : displayUnit === "tons" ? "0.01" : "1"} value={shownTarget} onChange={event => { const entered = Number(event.target.value); onChange(label, { target: percentage ? entered / 100 : entered * (displayUnit === "tons" ? 1000 : 1) }); }} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2.5 py-2 text-sm font-semibold text-slate-800"/><select value={config.direction} onChange={event => onChange(label, { direction: event.target.value as KpiTargetDirection })} className="w-[130px] rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs text-slate-700"><option value="lower-is-better">Lower is better</option><option value="higher-is-better">Higher is better</option></select></div><p className="mt-1 text-[10px] text-slate-400">{percentage ? "%" : displayUnit} target</p></div>;
    })}</div>
  </section>;
}

function KpiDetailModal({ kpi, rows, displayUnit, onClose }: { kpi: KpiDetail; rows: Record<string, unknown>[]; displayUnit: "kg" | "tons"; onClose: () => void }) {
  const [line, setLine] = useState<any>(null);
  const [lineLoading, setLineLoading] = useState(kpi.label === "Line Waste");
  const [lineError, setLineError] = useState("");
  const [stockTotal, setStockTotal] = useState<Record<string, unknown> | null>(null);
  const [stockError, setStockError] = useState("");
  const [rejectionSummary, setRejectionSummary] = useState<any>(null);
  const [rejectionError, setRejectionError] = useState("");
  useEffect(() => {
    if (kpi.label !== "Line Waste") return;
    let cancelled = false;
    setLineLoading(true); setLineError("");
    fetch(`${API}/api/kpis/line-waste`).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`);
      return body;
    }).then(body => { if (!cancelled) setLine(body); }).catch(cause => { if (!cancelled) setLineError(cause instanceof Error ? cause.message : "Request failed"); }).finally(() => { if (!cancelled) setLineLoading(false); });
    return () => { cancelled = true; };
  }, [kpi.label]);
  useEffect(() => {
    if (kpi.label !== "Rejection") return;
    let cancelled = false;
    setRejectionSummary(null); setRejectionError("");
    fetch(`${API}/api/kpis/rejection-reasons?_=${Date.now()}`, { cache: "no-store" }).then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`); return body; }).then(body => { if (!cancelled) setRejectionSummary(body); }).catch(cause => { if (!cancelled) setRejectionError(cause instanceof Error ? cause.message : "Could not load rejection reasons."); });
    return () => { cancelled = true; };
  }, [kpi.label]);
  useEffect(() => {
    const kind = kpi.label === "Metallized Stock Opening" ? "opening" : kpi.label === "Metallized Stock Closing" ? "closing" : null;
    if (!kind) return;
    fetch(`${API}/api/kpis/metallized-stock/${kind}`).then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.detail || `Request failed (${response.status})`); return body; }).then(body => setStockTotal(body.total || null)).catch(cause => setStockError(cause instanceof Error ? cause.message : "Could not load stock summary."));
  }, [kpi.label]);
  if (kpi.label === "Line Waste") return <LineWasteModal detail={line} loading={lineLoading} error={lineError} displayUnit={displayUnit} onClose={onClose} />;
  const items = rows.map(row => ({ film: String(row.Film || "Unspecified"), value: typeof row[kpi.field] === "number" ? row[kpi.field] as number : 0 })).filter(item => item.value !== 0).sort((a, b) => b.value - a.value);
  const isMetallizedStock = kpi.label === "Metallized Stock Opening" || kpi.label === "Metallized Stock Closing";
  const stockValue = (labels: string[]) => { const key = Object.keys(stockTotal || {}).find(candidate => labels.some(label => candidate.toLowerCase().replace(/\s+/g, " ").includes(label))); return key ? Number(stockTotal?.[key] || 0) : 0; };
  const total = kpi.unit === "%" ? (() => { const numeratorField = kpi.field === "Overall CPP waste %" ? "Overall CPP waste" : "Rejection"; const denominatorField = kpi.field === "Overall CPP waste %" ? "RM Input" : "Line Production"; const numerator = rows.reduce((sum, row) => sum + (typeof row[numeratorField] === "number" ? row[numeratorField] as number : 0), 0); const denominator = rows.reduce((sum, row) => sum + (typeof row[denominatorField] === "number" ? row[denominatorField] as number : 0), 0); return denominator ? numerator / denominator : 0; })() : items.reduce((sum, item) => sum + item.value, 0);
  if (isMetallizedStock) return <StockModal kpi={kpi} items={items} total={total} stockTotal={stockTotal} stockError={stockError} displayUnit={displayUnit} onClose={onClose} />;
  if (kpi.label === "Rejection") return <RejectionDebugModal summary={rejectionSummary} error={rejectionError} displayUnit={displayUnit} onClose={onClose} />;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl"><header className="bg-gradient-to-br from-teal-800 to-cyan-700 p-6 text-white"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-teal-100">KPI breakdown</p><h2 className="mt-2 text-xl font-bold">{kpi.label}</h2><p className="mt-1 text-2xl font-bold">{format(total, kpi.unit, displayUnit)} <span className="text-sm font-medium">{kpi.unit === "%" ? "%" : displayUnit === "tons" ? "tons" : "kg"}</span></p></div><button onClick={onClose} aria-label="Close" className="rounded-lg px-3 py-1 text-2xl leading-none text-white/80 hover:bg-white/15">×</button></div></header><div className="max-h-[55vh] overflow-auto p-5"><table className="min-w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-3 py-3">Film</th><th className="px-3 py-3 text-right">Value</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map((item, index) => <tr key={`${item.film}-${index}`}><td className="px-3 py-3 font-medium">{item.film}</td><td className="px-3 py-3 text-right">{format(item.value, kpi.unit, displayUnit)} {kpi.unit === "%" ? "%" : displayUnit === "tons" ? "tons" : "kg"}</td></tr>)}<tr className="border-t-2 border-slate-300 font-bold"><td className="px-3 py-3">Total</td><td className="px-3 py-3 text-right">{format(total, kpi.unit, displayUnit)} {kpi.unit === "%" ? "%" : displayUnit === "tons" ? "tons" : "kg"}</td></tr></tbody></table>{!items.length && <p className="p-8 text-center text-sm text-slate-500">No non-zero breakdown values are available for this KPI.</p>}</div></section></div>;
}

function RejectionModal({ summary, error, displayUnit, onClose }: { summary: any; error: string; displayUnit: "kg" | "tons"; onClose: () => void }) {
  const value = (amount: number) => `${format(amount, "", displayUnit)} ${displayUnit === "tons" ? "tons" : "kg"}`;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-3xl bg-white shadow-2xl"><header className="flex items-start justify-between bg-gradient-to-br from-teal-800 to-cyan-700 p-6 text-white"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-teal-100">Rejection detail</p><h2 className="mt-2 text-xl font-bold">Rejection by reason</h2><p className="mt-1 text-2xl font-bold">{summary ? value(summary.total) : "Loading..."}</p></div><button onClick={onClose} className="text-2xl text-white/80">×</button></header><div className="p-5">{error ? <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{error}</p> : summary && <><p className="mb-3 text-xs text-slate-500">Reporting weight field: <strong>{summary.weight_field}</strong></p><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Reason</th><th className="px-3 py-3 text-right">Total Weight ({displayUnit === "tons" ? "tons" : "Kg"})</th></tr></thead><tbody className="divide-y divide-slate-100">{summary.reasons.map((row: any) => <tr key={row.reason}><td className="px-3 py-3 font-medium">{row.reason}</td><td className="px-3 py-3 text-right">{value(row.weight)}</td></tr>)}<tr className="border-t-2 border-slate-300 font-bold"><td className="px-3 py-3">Total</td><td className="px-3 py-3 text-right">{value(summary.total)}</td></tr></tbody></table></>}</div></section></div>;
}

function RejectionNetModal({ summary, error, displayUnit, onClose }: { summary: any; error: string; displayUnit: "kg" | "tons"; onClose: () => void }) {
  const value = (amount: number) => `${format(amount, "", displayUnit)} ${displayUnit === "tons" ? "tons" : "kg"}`;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><section role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-3xl bg-white shadow-2xl"><header className="flex items-start justify-between bg-gradient-to-br from-teal-800 to-cyan-700 p-6 text-white"><div><p className="text-xs font-bold uppercase tracking-wider text-teal-100">Rejection detail</p><h2 className="mt-2 text-xl font-bold">Rejection by reason</h2><p className="mt-1 text-2xl font-bold">{summary ? value(summary.total.net) : "Loading..."}</p></div><button onClick={onClose} className="text-2xl">×</button></header><div className="p-5">{error ? <p className="text-rose-600">{error}</p> : summary && <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Reason</th><th className="px-3 py-3 text-right">Net Wt ({displayUnit === "tons" ? "tons" : "Kg"})</th></tr></thead><tbody className="divide-y divide-slate-100">{summary.reasons.map((row: any) => <tr key={row.reason}><td className="px-3 py-3 font-medium">{row.reason}</td><td className="px-3 py-3 text-right">{value(row.net)}</td></tr>)}<tr className="border-t-2 border-slate-300 font-bold"><td className="px-3 py-3">Total</td><td className="px-3 py-3 text-right">{value(summary.total.net)}</td></tr></tbody></table>}</div></section></div>;
}

function RejectionDebugModal({ summary, error, displayUnit, onClose }: { summary: any; error: string; displayUnit: "kg" | "tons"; onClose: () => void }) {
  const value = (amount: number) => `${format(amount, "", displayUnit)} ${displayUnit === "tons" ? "tons" : "kg"}`;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"><section role="dialog" aria-modal="true" className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl bg-white shadow-2xl"><header className="flex items-start justify-between bg-gradient-to-br from-teal-800 to-cyan-700 p-6 text-white"><div><p className="text-xs font-bold uppercase tracking-wider text-teal-100">Rejection detail</p><h2 className="mt-2 text-xl font-bold">Rejection by reason</h2><p className="mt-1 text-2xl font-bold">{summary ? value(summary.total.net) : "Loading..."}</p></div><button onClick={onClose} className="text-2xl">×</button></header><div className="space-y-2 p-5">{error ? <p className="text-rose-600">{error}</p> : summary && summary.reasons.map((row: any) => <details key={row.reason} className="rounded-xl border border-slate-200"><summary className="flex cursor-pointer list-none justify-between px-4 py-3 font-semibold"><span>{row.reason} <span className="text-xs font-normal text-slate-500">({row.count} rows)</span></span><span>{value(row.net)}</span></summary><div className="overflow-auto border-t border-slate-100 px-4 py-2"><table className="min-w-full text-xs"><thead className="text-left text-slate-500"><tr><th className="py-2 pr-4">Raw Reason</th><th className="py-2 pr-4 text-right">Net Wt</th><th className="py-2">Month</th></tr></thead><tbody>{(row.detail || []).map((item: any, index: number) => <tr key={`${row.reason}-${index}`} className="border-t border-slate-100"><td className="py-2 pr-4">{item.raw_reason}</td><td className="py-2 pr-4 text-right">{value(item.net)}</td><td className="py-2">{item.month_period || item.month || "—"}</td></tr>)}</tbody></table></div></details>)}</div></section></div>;
}

function StockModal({ kpi, items, total, stockTotal, stockError, displayUnit, onClose }: { kpi: KpiDetail; items: { film: string; value: number }[]; total: number; stockTotal: Record<string, unknown> | null; stockError: string; displayUnit: "kg" | "tons"; onClose: () => void }) {
  const value = (amount: number) => `${format(amount, kpi.unit, displayUnit)} ${displayUnit === "tons" ? "tons" : "kg"}`;
  const get = (terms: string[]) => { const key = Object.keys(stockTotal || {}).find(name => terms.some(term => name.toLowerCase().replace(/\s+/g, " ").includes(term))); return Number(key ? stockTotal?.[key] || 0 : 0); };
  const fields: [string, string[]][] = [["Good stock (Kg)", ["good stock"]], ["Low productive stock (Kg)", ["low productive"]], ["Hold stock (Kg)", ["hold stock", "hold/reworkable"]], ["Rejected (Kg)", ["rejected"]], ["Trial rolls (Kg)", ["trial rolls"]], ["Total (Kg)", ["total"]]];
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-3xl bg-white shadow-2xl"><header className="bg-gradient-to-br from-teal-800 to-cyan-700 p-6 text-white"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-teal-100">KPI breakdown</p><h2 className="mt-2 text-xl font-bold">{kpi.label}</h2><p className="mt-1 text-2xl font-bold">{value(total)}</p></div><button onClick={onClose} className="text-2xl text-white/80">×</button></div></header><div className="p-5"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Film</th><th className="px-3 py-3 text-right">Value</th></tr></thead><tbody className="divide-y divide-slate-100">{items.map(item => <tr key={item.film}><td className="px-3 py-3 font-medium">{item.film}</td><td className="px-3 py-3 text-right">{value(item.value)}</td></tr>)}<tr className="border-t-2 border-slate-300 font-bold"><td className="px-3 py-3">Total</td><td className="px-3 py-3 text-right">{value(total)}</td></tr></tbody></table><div className="mt-5 rounded-xl border border-teal-100 bg-teal-50/60 p-3"><h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-teal-800">Total stock composition</h3>{stockError ? <p className="text-xs text-rose-600">{stockError}</p> : <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{fields.map(([label, terms]) => <div key={label} className="rounded-lg bg-white px-2 py-2"><p className="text-[10px] text-slate-500">{label}</p><strong className="text-sm text-slate-900">{value(get(terms))}</strong></div>)}</div>}</div></div></section></div>;
}

function LineWasteModal({ detail, loading, error, displayUnit, onClose }: { detail: any; loading: boolean; error: string; displayUnit: "kg" | "tons"; onClose: () => void }) {
  const unit = displayUnit === "tons" ? "tons" : "kg";
  if (loading || !detail) return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl"><header className="flex items-center justify-between bg-gradient-to-br from-teal-800 to-cyan-700 p-6 text-white"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-teal-100">Line Waste detail</p><h2 className="mt-2 text-xl font-bold">{error ? "Couldn't load Line Waste detail" : "Loading Line waste data..."}</h2></div><button onClick={onClose} className="text-2xl text-white/80">×</button></header><p className={`p-8 text-center text-sm ${error ? "text-rose-600" : "text-slate-500"}`}>{error || "Reading the Line waste sheet for the current reporting month."}</p></section></div>;
  const value = (v: number) => format(v, "", displayUnit);
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-3xl bg-white shadow-2xl"><header className="flex items-start justify-between bg-gradient-to-br from-teal-800 to-cyan-700 p-6 text-white"><div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-teal-100">Line Waste · {detail.month || "Current month"}</p><h2 className="mt-2 text-xl font-bold">Line Waste detail</h2><p className="mt-1 text-2xl font-bold">{value(detail.summary.waste)} {unit}</p></div><button onClick={onClose} className="text-2xl text-white/80">×</button></header><div className="grid gap-3 p-5 sm:grid-cols-4">{[["Total Waste",`${value(detail.summary.waste)} ${unit}`],["Downtime",`${detail.summary.hours.toFixed(1)} hrs`],["Instances",detail.summary.instances],["Distinct events",detail.summary.events]].map(([label,val])=><div className="rounded-xl bg-teal-50 p-3" key={label}><p className="text-xs text-slate-500">{label}</p><strong className="text-lg text-slate-900">{val}</strong></div>)}</div><div className="px-5 pb-6"><h3 className="mb-3 font-bold">Breakdown by Film and Category</h3><div className="space-y-2">{detail.film_categories.map((film: any) => <details key={film.film} className="overflow-hidden rounded-xl border border-slate-200" open={detail.film_categories.length <= 4}><summary className="flex cursor-pointer list-none items-center justify-between bg-slate-50 px-4 py-3 font-bold text-slate-800"><span>{film.film}</span><span>{value(film.total)} {unit}</span></summary><div className="divide-y divide-slate-100">{film.categories.map((category: any) => <div key={category.name} className="flex items-center justify-between px-6 py-2.5 text-sm"><span className="text-slate-600">{category.name}</span><span className="font-semibold text-slate-800">{value(category.waste)} {unit}</span></div>)}</div></details>)}</div><div className="mt-4 flex justify-between border-t-2 border-slate-300 px-4 pt-3 font-bold"><span>Total</span><span>{value(detail.summary.waste)} {unit}</span></div></div></section></div>;
}

function Breakdown({ rows, unit, value, showShare = false }: { rows: any[]; unit: string; value: (n: number) => string; showShare?: boolean }) { return <div className="overflow-hidden rounded-xl border border-slate-200"><table className="min-w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2 text-right">Waste ({unit})</th><th className="px-3 py-2 text-right">Hours</th><th className="px-3 py-2 text-right">Instances</th>{showShare && <th className="px-3 py-2">Share</th>}</tr></thead><tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.name}><td className="px-3 py-2 font-medium">{row.name}</td><td className="px-3 py-2 text-right">{value(row.waste)}</td><td className="px-3 py-2 text-right">{row.hours.toFixed(1)}</td><td className="px-3 py-2 text-right">{row.instances}</td>{showShare && <td className="px-3 py-2"><div className="h-2 w-24 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-teal-600" style={{width:`${row.share}%`}}/></div></td>}</tr>)}<tr className="border-t-2 border-slate-300 font-bold"><td className="px-3 py-2">Total</td><td className="px-3 py-2 text-right">{value(rows.reduce((s,r)=>s+r.waste,0))}</td><td className="px-3 py-2 text-right">{rows.reduce((s,r)=>s+r.hours,0).toFixed(1)}</td><td className="px-3 py-2 text-right">{rows.reduce((s,r)=>s+r.instances,0)}</td>{showShare && <td className="px-3 py-2">100%</td>}</tr></tbody></table></div>; }
