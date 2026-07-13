import { useEffect, useState } from "react";

const rawEquations = {
  eqROCE: String.raw`\mathrm{ROCE}_t = \frac{\mathrm{CNI}_t}{\overline{\mathrm{CSE}}}`,
  eqRNOA: String.raw`\mathrm{RNOA}_t = \frac{\mathrm{OI}_t}{\overline{\mathrm{NOA}}}`,
  eqRE: String.raw`\mathrm{RE}_t = \mathrm{CNI}_t - k_e\,\mathrm{CSE}_{t-1}`,
  eqReOI: String.raw`\mathrm{ReOI}_t = \mathrm{OI}_t - k_w\,\mathrm{NOA}_{t-1}`,
};

export function useAcademicEquations() {
  const [equations, setEquations] = useState(rawEquations);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { default: katex } = await import("katex");
      if (cancelled) return;
      setEquations({
        eqROCE: katex.renderToString(rawEquations.eqROCE, { throwOnError: false, displayMode: true }),
        eqRNOA: katex.renderToString(rawEquations.eqRNOA, { throwOnError: false, displayMode: true }),
        eqRE: katex.renderToString(rawEquations.eqRE, { throwOnError: false, displayMode: true }),
        eqReOI: katex.renderToString(rawEquations.eqReOI, { throwOnError: false, displayMode: true }),
      });
    })();
    return () => { cancelled = true; };
  }, []);

  return equations;
}
