import { ForecastScenarioKey, ForecastScenarioWeighting } from "../../engine/types";

export const pct = (v:number,d=1) => (v*100).toFixed(d)+"%";
export const cr  = (v:number) => v.toLocaleString("en-IN",{maximumFractionDigits:0});
export const share = (v:number | null | undefined, d=2) => v == null ? "—" : `₹${v.toFixed(d)}`;

export function fadeArr(base:number,alpha:number,target:number,t:number):number[] {
  const arr:number[]=[];let prev=base;
  for(let i=0;i<t;i++){const n=alpha*prev+(1-alpha)*target;arr.push(n);prev=n;}
  return arr;
}

export function scenarioWeightForKey(weights: ForecastScenarioWeighting, key: ForecastScenarioKey) {
  switch (key) {
    case "stress":
      return weights.stress;
    case "base":
      return weights.base;
    case "bull":
      return weights.bull;
    case "historical-panic":
      return weights.historicalPanic;
  }
}

export function scenarioColor(key: ForecastScenarioKey) {
  switch (key) {
    case "stress":
      return "#f59e0b";
    case "base":
      return "#6366f1";
    case "bull":
      return "#10b981";
    case "historical-panic":
      return "#ef4444";
  }
}

export function updateWeightsForKey(
  weights: ForecastScenarioWeighting,
  key: ForecastScenarioKey,
  value: number,
): ForecastScenarioWeighting {
  switch (key) {
    case "stress":
      return { ...weights, stress: value };
    case "base":
      return { ...weights, base: value };
    case "bull":
      return { ...weights, bull: value };
    case "historical-panic":
      return { ...weights, historicalPanic: value };
  }
}
