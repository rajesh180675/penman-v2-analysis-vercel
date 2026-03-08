import MonteCarloWorker from "./monteCarloWorker?worker";
import {
  MonteCarloRequest,
  MonteCarloOutput,
  MonteCarloProgressMessage,
  normalizeMonteCarloRequest,
} from "./monteCarloTypes";

export function runMonteCarlo(req: MonteCarloRequest, onProgress?: (p: number) => void): Promise<MonteCarloOutput> {
  return new Promise((resolve, reject) => {
    const worker = new MonteCarloWorker();
    worker.onmessage = (ev: MessageEvent<MonteCarloOutput | MonteCarloProgressMessage>) => {
      if (typeof (ev.data as MonteCarloProgressMessage)?.progress === "number") {
        onProgress?.((ev.data as MonteCarloProgressMessage).progress);
        return;
      }
      resolve(ev.data as MonteCarloOutput);
      worker.terminate();
    };
    worker.onerror = (e) => {
      reject(e);
      worker.terminate();
    };
    worker.postMessage(normalizeMonteCarloRequest(req));
  });
}
