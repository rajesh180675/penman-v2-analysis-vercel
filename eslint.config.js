/* ================================================================
   P7 — ESLint. This project had no linter at all before this file: no
   `.eslintrc*`, no `eslint.config.*`, no binary. It did however already carry
   `eslint-disable` comments in seven files, which is worse than having no
   linter — they read as suppressions of enforced rules while nothing was
   enforcing anything.

   The rule selection below is deliberately narrow, and the reason matters:
   turning on the full recommended sets at once on ~500 previously unlinted
   files produces an error count nobody triages, so the linter gets excluded
   from `validate` and stops being a gate. A smaller set that actually runs
   green is worth more than a large set that is permanently skipped.

   Specifically NOT enabled yet, each a deliberate follow-up rather than an
   oversight:
   - `tseslint.configs.recommendedTypeChecked` — the type-aware rules
     (`no-floating-promises`, `no-unsafe-*`) are the valuable ones and are the
     natural next ratchet, but they need `projectService` and would flag most
     `any`-adjacent code in one sweep.
   - The 14 React-Compiler rules new in eslint-plugin-react-hooks 7
     (`purity`, `immutability`, `set-state-in-effect`, …). Only
     `rules-of-hooks` and `exhaustive-deps` are on, which are exactly the two
     the pre-existing disable comments in this repo already assumed.
================================================================ */

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Build output, third-party, and generated artifacts. `public/` holds
    // company data fixtures, not source.
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "public/**",
      "__pycache__/**",
      "meta/**",
      "audit-baselines/**",
      "ui_views/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx,js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      /**
       * Warn, not error. `scripts/check-any-budget.cjs` is the blocking gate
       * for explicit `any` and enforces a per-file budget with a total
       * ceiling; making this an error too would mean two gates disagreeing
       * about the same debt, and the budget file is the one that records
       * which occurrences are accepted (jszip typing gaps, parser inputs).
       */
      "@typescript-eslint/no-explicit-any": "warn",
      /**
       * Warn, not error: `tsconfig` already sets noUnusedLocals and
       * noUnusedParameters, so dead bindings in typechecked code fail the
       * typecheck first. What is left here is untypechecked `.js`/`.cjs` and a
       * couple of assigned-but-never-read counters that predate this linter.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],

      /**
       * Warn. This fires on `let reason = ""` followed by an assignment in
       * every branch — a documentary-initializer pattern used in ~9 engine
       * files. The initializer is genuinely dead, but it states the default a
       * reader should assume, and rewriting nine unrelated valuation files to
       * satisfy a new linter is not a change any of them asked for.
       */
      "no-useless-assignment": "warn",

      /**
       * Warn. The three occurrences are `/[\/\\]/` in path-traversal guards.
       * The escape is redundant inside a character class but harmless, and
       * these are security checks — not somewhere to make a cosmetic edit for
       * a style rule.
       */
      "no-useless-escape": "warn",

      /**
       * Error, and at zero occurrences. An ESLint 10 rule asking rethrows to
       * pass `cause`. This was `warn` while the six parser and pipeline sites it
       * found still discarded their original error; all six now thread
       * `{ cause: err }`, so the rule is promoted rather than left as a warning
       * the ratchet would absorb — a new wrapped rethrow that drops its cause
       * should fail, not quietly consume one of the remaining 72 slots.
       *
       * Enabling `cause` needed `"ES2022.Error"` in tsconfig's `lib`; see the
       * comment there for why the target stays ES2020.
       */
      "preserve-caught-error": "error",

      // An empty catch is the idiomatic "best-effort, failure is fine" marker
      // and is used deliberately here.
      "no-empty": ["error", { allowEmptyCatch: true }],

      /**
       * `capitalineParser/cells.ts` matches a literal non-breaking space in a
       * regex on purpose, to normalize NBSP out of Capitaline exports. Writing
       * it as an escape would be more readable, but the character being
       * matched is the point, so allow it in regexes and strings.
       */
      "no-irregular-whitespace": ["error", { skipRegExps: true, skipStrings: true }],
    },
  },

  {
    // `.cjs` is precisely how CommonJS is written in a `"type": "module"`
    // package, so `require` here is correct rather than legacy.
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      /**
       * `const crypto = require("crypto")` is the standard CommonJS import and
       * only reads as a redeclaration because modern Node also exposes a
       * `crypto` global. Requiring the module explicitly is the more portable
       * of the two, so the import stays and the rule stands down here.
       */
      "no-redeclare": "off",
    },
  },

  {
    // These modules exist to strip control characters out of filenames and PDF
    // text, so control characters in their regexes are the feature.
    files: ["src/reporting/**/*.ts"],
    rules: { "no-control-regex": "off" },
  },

  {
    // k6 load-test scripts run in the k6 runtime, not Node.
    files: ["scripts/load-tests/**/*.js"],
    languageOptions: { globals: { __ENV: "readonly", __VU: "readonly", __ITER: "readonly" } },
  },

  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      /**
       * Enabled because this repo already carries `eslint-disable-next-line
       * no-console` comments under src/: the authors expected this rule to be
       * enforced, and until this config existed nothing was.
       *
       * `assert`/`warn`/`error` are allowed because every current call site is
       * a deliberate diagnostic: `console.assert` in reconciliationResiduals.ts
       * guards documented engine invariants, `lib/audit.ts` and the audit /
       * sidecar hooks warn when a best-effort persistence write is dropped, and
       * `lib/observability.ts` IS the console sink. Reviewing 17 accepted
       * warnings on every lint run is how a genuinely stray log gets missed.
       *
       * What stays flagged is `console.log`/`info`/`debug` — the shape stray
       * debugging actually takes. Warn rather than error so a new one surfaces
       * in the ratchet without failing the build mid-edit.
       */
      "no-console": ["warn", { allow: ["assert", "warn", "error"] }],
      // A hook called conditionally is a real defect, not a style opinion.
      "react-hooks/rules-of-hooks": "error",
      // Warn: this codebase intentionally omits deps in several memos and says
      // so with disable comments. Erroring would fail the build on choices
      // already reviewed.
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  {
    // Node-side code: serverless functions, the local server, build scripts.
    files: ["api/**/*.{js,ts}", "server/**/*.{js,ts}", "scripts/**/*.{js,ts,cjs,mjs}", "*.{js,cjs,mjs,ts}"],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    // Tests legitimately reach for `any`/`as unknown as` to build partial
    // fixtures of large engine types; that is fixture-shaping, not production
    // typing debt, and the any-budget script already excludes them.
    files: ["**/__tests__/**", "**/*.spec.{ts,tsx}", "src/test/**", "e2e/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      // Test harnesses report progress on stdout — that is their output
      // channel, not stray debugging.
      "no-console": "off",
    },
  },
);
