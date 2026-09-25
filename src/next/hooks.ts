import { useCallback, useEffect, useState } from "react";
import { parseLibraryCompanyRegistry, type LibraryCompany } from "../components/data-entry/companyRegistry";
import type { CompanyTrackRecord } from "../engine/accountability";
import { CompanyRunCache, type CompanyRunState } from "./companyRun";
import { formatRoute, parseRoute, type Route } from "./route";

/** The current route, following the URL hash. */
export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: Route) => {
    window.location.hash = formatRoute(next);
  }, []);
  return [route, navigate];
}

export type RegistryState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly companies: readonly LibraryCompany[] }
  | { readonly status: "error"; readonly message: string };

/** The company library, from the bundled registry. */
export function useRegistry(): RegistryState {
  const [state, setState] = useState<RegistryState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/data/companies/registry.json")
      .then((response) => {
        if (!response.ok) throw new Error(`Company registry unavailable (${response.status}).`);
        return response.json() as Promise<unknown>;
      })
      .then((data) => {
        if (!cancelled) setState({ status: "ready", companies: parseLibraryCompanyRegistry(data).companies });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => { cancelled = true; };
  }, []);
  return state;
}

const sessionRuns = new CompanyRunCache();

/** The shared analysis run for one company (null while no company is selected). */
export function useCompanyRun(company: LibraryCompany | null, cache: CompanyRunCache = sessionRuns): CompanyRunState | null {
  const [state, setState] = useState<CompanyRunState | null>(null);
  useEffect(() => {
    if (!company) {
      setState(null);
      return;
    }
    let cancelled = false;
    setState({ status: "loading", step: "fetching" });
    void cache.get(company, (step) => {
      if (!cancelled) setState({ status: "loading", step });
    }).then((settled) => {
      if (!cancelled) setState(settled);
    });
    return () => { cancelled = true; };
  }, [company, cache]);
  return state;
}

export interface TrackRecordFile {
  readonly madeAt: string;
  readonly basis: string;
  readonly companies: readonly CompanyTrackRecord[];
}

let trackRecordRequest: Promise<TrackRecordFile | null> | null = null;

/** The backtest's per-company record (fetched once per session; null if unavailable). */
export function useTrackRecord(): TrackRecordFile | null {
  const [file, setFile] = useState<TrackRecordFile | null>(null);
  useEffect(() => {
    let cancelled = false;
    trackRecordRequest ??= fetch("/data/accountability/track-record.json")
      .then((response) => (response.ok ? (response.json() as Promise<TrackRecordFile>) : null))
      .catch(() => null);
    void trackRecordRequest.then((value) => { if (!cancelled) setFile(value); });
    return () => { cancelled = true; };
  }, []);
  return file;
}
