"use client";

import { useEffect, useState } from "react";
import Dashboard from "../components/Dashboard";
import Upload from "../components/Upload";

/** Legacy single-workbook Waste dashboard entry point. */
export default function Page() {
  const [view, setView] = useState<"checking" | "upload" | "dashboard">("checking");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const api = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
    fetch(`${api}/api/health`, { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("Health check failed")))
      .then(status => setView(status.uploaded ? "dashboard" : "upload"))
      .catch(() => setView("upload"));
  }, []);

  if (view === "checking") return <main className="waste-shell grid min-h-screen place-items-center text-sm text-slate-600">Checking uploaded dashboard data…</main>;
  if (view === "upload") return <Upload onUploaded={() => { setVersion(current => current + 1); setView("dashboard"); }} />;
  return <Dashboard key={version} onUploadNew={() => setView("upload")} />;
}
