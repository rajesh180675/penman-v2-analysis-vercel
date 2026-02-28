import type { RecastPeriod } from "./types";
import MonteCarloWorker from "./monteCarloWorker?worker";

export interface MonteCarloRequest {
  basePeriods: RecastPeriod[];
  config: any;
  N?: number;
  horizonT?: number;
  paramDistributions: {
    ke: { mean: number; std: number };
    kw: { mean: number; std: number };
    g: { mean: number; std: number };
  };
}

export function runMonteCarlo(req: MonteCarloRequest, onProgress?: (p: number) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const worker = new MonteCarloWorker();
    worker.onmessage = (ev: MessageEvent<any>) => {
      if (typeof ev.data?.progress === "number") {
        onProgress?.(ev.data.progress);
        return;
      }
      resolve(ev.data);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(e);
      worker.terminate();
    };
    worker.postMessage({
      ...req,
      N: req.N ?? 10000,
      horizonT: req.horizonT ?? 5,
    });
  });
}
