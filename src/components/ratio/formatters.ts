export const pct  = (v:number|null|undefined,d=1) => v!=null?(v*100).toFixed(d)+"%" : "—";
export const mult = (v:number|null|undefined,d=2) => v!=null?v.toFixed(d)+"×" : "—";
export const num  = (v:number|null|undefined,d=0) => v!=null?v.toLocaleString("en-IN",{maximumFractionDigits:d}) : "—";
export const days = (v:number|null|undefined) => v!=null?v.toFixed(0)+"d" : "—";
