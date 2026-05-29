/* Pure type leaf — mapping backlog triage enums.
   Relocated from logic module(s) to break the types-barrel <-> analysisTraceability
   cycle (weakness #1). mappingBacklogPolicy reaches the tangle, so these pure unions move here.
   Contains ONLY types (no runtime values), imports only other pure leaves, so it
   can never re-enter the engine's type->logic->type tangle. The originating logic
   module re-exports these names, so existing import paths stay valid. */

export type BacklogTriageAction = "add-to-spec" | "group-to-existing" | "ignore-non-core" | "review";
export type BacklogPriority = "blocking" | "diagnostic" | "optional";
