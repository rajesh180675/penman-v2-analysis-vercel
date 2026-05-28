/* ================================================================
   Plan 9 PR-9.4 — k6 load test: research API endpoint.

   Run locally:
     k6 run --vus 10 --duration 30s scripts/load-tests/research-api.js

   Or against a deployed preview:
     RESEARCH_BASE_URL=https://<preview>.vercel.app k6 run scripts/load-tests/research-api.js

   Thresholds match docs/load-test-baselines.json. CI runs a smoke
   variant (--vus 2 --duration 10s) on a feature flag; the full
   load test is on-demand.
================================================================ */

import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.RESEARCH_BASE_URL || "http://localhost:3001";

export const options = {
  vus: 10,
  duration: "30s",
  thresholds: {
    // Match research API baseline
    http_req_duration: ["p(95)<800", "p(99)<2000"],
    http_req_failed: ["rate<0.02"],
  },
};

export default function () {
  // Read-heavy: audit-run list (the most-hit endpoint in normal use)
  const list = http.get(`${BASE}/api/research?action=list-runs`, {
    tags: { name: "list-runs" },
  });
  check(list, {
    "list-runs status 200 or 401 (401 if not logged in)": (r) =>
      r.status === 200 || r.status === 401,
    "list-runs body is JSON": (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  // Read-heavy: comparison registry fetch
  const reg = http.get(`${BASE}/api/research?action=load-comparison-registry`, {
    tags: { name: "load-registry" },
  });
  check(reg, {
    "load-registry 200/401": (r) => r.status === 200 || r.status === 401,
  });

  sleep(1);
}
