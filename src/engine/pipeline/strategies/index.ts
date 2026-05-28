/* ================================================================
   Plan 3 PR-3.2 — strategy registration entry point.

   Importing this module triggers registration of every concrete
   pipeline strategy in priority order. Order matters: industrial
   is the catch-all and MUST be last.

   In PR-3.2 only the industrial strategy is wired; PR-3.3 onwards
   will prepend bank, NBFC, and insurance.
================================================================ */

// Concrete strategy imports. Each module calls registerStrategy()
// at the bottom of its file as an import side-effect.
//
// Order matters: industrial is the catch-all and MUST be last
// (its matches() returns true unconditionally). Sector-specific
// strategies prepend.
import "./bank";
import "./industrial";
