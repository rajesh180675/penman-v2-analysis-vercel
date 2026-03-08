export function convergenceByHalfMeans(samples: number[], tolerance = 0.02): boolean {
  const n = samples.length;
  if (n < 2) return false;

  const halfN = Math.floor(n / 2);
  const first = samples.slice(0, halfN);
  const second = samples.slice(halfN);
  if (!first.length || !second.length) return false;

  const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const meanFirst = mean(first);
  const meanSecond = mean(second);
  const meanAll = mean(samples);

  if (meanAll === 0) return false;
  return Math.abs(meanFirst - meanSecond) / Math.abs(meanAll) < tolerance;
}
