export interface LibraryCompany {
  /** Folder name in public/data/companies/ */
  folder: string;
  /** Display name */
  name: string;
  /** NSE ticker, used as default ID */
  ticker: string;
  /** Sector category */
  sector: string;
  /** Type for routing/architecture */
  type: LibraryCompanyType;
  /** One-line description */
  description: string;
  /** Visual identifier emoji */
  emoji: string;
  /** Why this is interesting for testing */
  showcaseFor?: string | undefined;
  /** Whether standalone statements are preloaded */
  hasStandalone?: boolean | undefined;
  /** Vercel Blob URL for consolidated ZIP (set after upload-to-blob script runs) */
  blobUrl?: string | undefined;
  /** Vercel Blob URL for standalone ZIP */
  standaloneBlobUrl?: string | undefined;
  /** Vercel Blob URL for quality_indicators.json sidecar */
  qualityIndicatorsBlobUrl?: string | undefined;
  /** Vercel Blob URLs for XLS sidecar folders */
  sidecarBlobs?: {
    subsidiaries?: string[] | undefined;
    rbiNhbBanks?: string[] | undefined;
    lossGivenDefault?: string[] | undefined;
  } | undefined;
}

export type LibraryCompanyType =
  | "industrial"
  | "bank"
  | "nbfc"
  | "insurance"
  | "it-services"
  | "consumer"
  | "utility"
  | "telecom"
  | "cyclical"
  | "loss-maker"
  | "conglomerate";

const VALID_TYPES = new Set<LibraryCompanyType>([
  "industrial",
  "bank",
  "nbfc",
  "insurance",
  "it-services",
  "consumer",
  "utility",
  "telecom",
  "cyclical",
  "loss-maker",
  "conglomerate",
]);

const REQUIRED_STRING_FIELDS = [
  "folder",
  "name",
  "ticker",
  "sector",
  "type",
  "description",
  "emoji",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(isNonEmptyString);
  return strings.length === value.length ? strings : undefined;
}

export function parseLibraryCompanyRegistry(data: unknown): { companies: LibraryCompany[]; errors: string[] } {
  if (!Array.isArray(data)) {
    return { companies: [], errors: ["registry root must be an array"] };
  }

  const companies: LibraryCompany[] = [];
  const errors: string[] = [];
  const folders = new Set<string>();
  const tickers = new Set<string>();

  data.forEach((row, index) => {
    const record = asRecord(row);
    if (!record) {
      errors.push(`registry[${index}] must be an object`);
      return;
    }

    for (const field of REQUIRED_STRING_FIELDS) {
      if (!isNonEmptyString(record[field])) {
        errors.push(`registry[${index}].${field} is required`);
        return;
      }
    }

    const type = record.type as LibraryCompanyType;
    if (!VALID_TYPES.has(type)) {
      errors.push(`registry[${index}].type is not supported: ${record.type}`);
      return;
    }

    const folder = (record.folder as string).trim();
    const ticker = (record.ticker as string).trim();
    if (folders.has(folder)) {
      errors.push(`registry[${index}].folder duplicates ${folder}`);
      return;
    }
    if (tickers.has(ticker)) {
      errors.push(`registry[${index}].ticker duplicates ${ticker}`);
      return;
    }
    folders.add(folder);
    tickers.add(ticker);

    const sidecarRecord = asRecord(record.sidecarBlobs);
    companies.push({
      folder,
      name: (record.name as string).trim(),
      ticker,
      sector: (record.sector as string).trim(),
      type,
      description: (record.description as string).trim(),
      emoji: (record.emoji as string).trim(),
      showcaseFor: optionalString(record.showcaseFor),
      hasStandalone: typeof record.hasStandalone === "boolean" ? record.hasStandalone : undefined,
      blobUrl: optionalString(record.blobUrl),
      standaloneBlobUrl: optionalString(record.standaloneBlobUrl),
      qualityIndicatorsBlobUrl: optionalString(record.qualityIndicatorsBlobUrl),
      sidecarBlobs: sidecarRecord ? {
        subsidiaries: optionalStringArray(sidecarRecord.subsidiaries),
        rbiNhbBanks: optionalStringArray(sidecarRecord.rbiNhbBanks),
        lossGivenDefault: optionalStringArray(sidecarRecord.lossGivenDefault),
      } : undefined,
    });
  });

  return { companies, errors };
}

/** Resolve a share/deep-link company token by ticker, display name, or folder. */
export function findLibraryCompany(
  companies: readonly LibraryCompany[],
  reference: string,
): LibraryCompany | null {
  const normalize = (value: string) => value
    .trim()
    .toLocaleLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  const needle = normalize(reference);
  if (!needle) return null;
  return companies.find((company) =>
    normalize(company.ticker) === needle
    || normalize(company.name) === needle
    || normalize(company.folder) === needle
  ) ?? null;
}

export function buildLocalLibraryCompanyUrls(company: Pick<LibraryCompany, "folder">): {
  consolidated: string;
  standalone: string;
} {
  const encodedFolder = encodeURIComponent(company.folder).replace(/%26/g, "&");
  return {
    consolidated: `/data/companies/${encodedFolder}/${encodedFolder}.zip`,
    standalone: `/data/companies/${encodedFolder}/standalone.zip`,
  };
}
