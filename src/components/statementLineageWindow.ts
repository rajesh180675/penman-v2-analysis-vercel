/**
 * How many of each lineage list `StatementLineagePanel` has room for.
 *
 * Named rather than inline because each one is half of a claim: the panel must
 * also say how many it left out, and the two numbers have to come from the same
 * place or the note can drift from the list it describes.
 *
 * The `capped` helper these feed moved to `./cappedList` once other surfaces
 * needed it — it was never lineage-specific.
 */
export const VERSIONS_SHOWN = 6;
export const CANDIDATES_SHOWN = 4;
export const SEGMENT_HINTS_SHOWN = 12;
