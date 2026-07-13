import type {
  ContractError,
  FactSet,
  FactSetContent,
  FailClosedResult,
  ValidatedFactSet,
} from "./contracts";
import { hashFactSetContent, verifyFactSetIdentity } from "./identity";
import { validateFactSet, validateFactSetContent } from "./validation";

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => cloneAndFreeze(item))) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) clone[key] = cloneAndFreeze(nested);
    return Object.freeze(clone) as unknown as T;
  }
  return value;
}

/** Validate, content-address, and deeply freeze a new canonical FactSet. */
export async function createFactSet(
  content: FactSetContent,
): Promise<FailClosedResult<ValidatedFactSet>> {
  const validatedContent = validateFactSetContent(content);
  if (validatedContent.ok === false) return validatedContent;

  const factSetId = await hashFactSetContent(validatedContent.value);
  const candidate: FactSet = { ...validatedContent.value, factSetId };
  const validated = validateFactSet(candidate);
  if (validated.ok === false) return validated;
  return { ok: true, value: cloneAndFreeze(validated.value) };
}

/**
 * Validate a persisted set and verify that its stable content still matches
 * its stamped identity. A mismatch remains data, never an exception or a
 * silently repaired id.
 */
export async function validateAndVerifyFactSet(
  input: unknown,
): Promise<FailClosedResult<ValidatedFactSet>> {
  const validated = validateFactSet(input);
  if (validated.ok === false) return validated;
  if (await verifyFactSetIdentity(validated.value)) return validated;

  const error: ContractError = {
    code: "invalid-hash",
    path: "$.factSetId",
    message: "FactSet content does not match its stamped SHA-256 identity.",
  };
  return { ok: false, errors: [error] };
}
