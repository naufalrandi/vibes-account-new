import { ImplementationRecord } from "../../db/models";

/**
 * External Documents (tn-m-records) — the server-side half of OD's `ed*`
 * helpers (index.html:13005–13064). The record bodies live 1:1 in
 * `implementation_records.data`; this module owns the ID scheme
 * (`EXT-<CAT_CODE>-NNNN`) and the per-org lazy seed of the 12 folders and
 * 6 starter documents (`edSeedIfNeeded`).
 */

/** OD `ED_CAT_CODE` (13006) — category → the ID's middle segment. */
export const ED_CAT_CODE: Record<string, string> = {
  Standard: "STD", Regulation: "REG", Law: "LAW", "Government Guideline": "GOV",
  "Customer Requirement": "CUS", "Supplier Document": "SUP", "Official Letter": "LET",
  "Accreditation Rule": "ACC", "Certification Scheme Document": "CSD",
  "Technical Manual": "MAN", Contract: "CON", "Other Reference": "OTH",
};

/**
 * OD `edDocNum` + `edDocNewId` (13022–13023): one number sequence per tenant
 * across ALL external documents regardless of category segment, then
 * `EXT-<CAT_CODE>-NNNN` (unknown categories fall back to DOC).
 */
export async function extDocCode(orgId: string, category: unknown): Promise<string> {
  const rows = await ImplementationRecord.findAll({ where: { orgId, module: "records" }, attributes: ["code"] });
  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt((r.code || "").replace(/^EXT-(?:[A-Z]+-)?/, "").replace(/\D/g, ""), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const code = ED_CAT_CODE[String(category ?? "")] ?? "DOC";
  return `EXT-${code}-${String(max + 1).padStart(4, "0")}`;
}

/** OD `edSeedIfNeeded` folder list (13039–13051) — name + description, 1:1. */
const ED_FOLDER_SEED: [string, string][] = [
  ["Standards", "International, national, or industry standards used as management system criteria or reference documents."],
  ["Regulations", "Regulatory documents issued by authorities that may apply to the organization."],
  ["Laws", "Legal instruments, acts, and statutory documents applicable to the organization."],
  ["Government Guidelines", "Guidelines, circulars, and official guidance issued by government bodies."],
  ["Official Letters", "Formal external correspondence, letters, notices, or decisions received from customers, regulators, authorities, or other external parties."],
  ["Customer Requirements", "Customer-issued requirements, specifications, manuals, or contractual expectations."],
  ["Supplier Documents", "Supplier-issued manuals, specifications, certifications, notices, or service documents."],
  ["Accreditation Rules", "Accreditation body requirements, regulations, rules, or guidance documents."],
  ["Certification Scheme Documents", "Certification scheme rules, scheme owner documents, certification requirements, and related guidance."],
  ["Technical Manuals", "Externally issued manuals, equipment manuals, technical references, or operating instructions."],
  ["Contracts", "External agreements, contracts, memoranda, or formal commitments relevant to the management system."],
  ["Other References", "Other externally issued reference documents used by the organization."],
];

interface SeedDoc {
  code: string;
  folder: string;
  category: string;
  title: string;
  issuer?: string;
  publisher?: string;
  number?: string;
  version?: string;
  receivedDate?: string;
  link?: string;
  owner?: string;
  frameworks?: string[];
  obligations?: string[];
  workUnits?: string[];
  file?: { name: string; size: number } | null;
}

/** OD's 6 seeded external documents (13055–13063), 1:1. */
const ED_DOC_SEED: SeedDoc[] = [
  {
    code: "EXT-STD-0001", folder: "Standards", category: "Standard",
    title: "ISO 9001:2015 Quality Management Systems — Requirements",
    issuer: "ISO", publisher: "International Organization for Standardization",
    number: "ISO 9001:2015", version: "2015",
    file: { name: "ISO-9001-2015.pdf", size: 1180000 }, frameworks: ["ISO 9001:2015"],
  },
  {
    code: "EXT-STD-0002", folder: "Standards", category: "Standard",
    title: "ISO/IEC 27001:2022 Information Security Management Systems — Requirements",
    issuer: "ISO / IEC",
    publisher: "International Organization for Standardization / International Electrotechnical Commission",
    number: "ISO/IEC 27001:2022", version: "2022",
    file: { name: "ISO-IEC-27001-2022.pdf", size: 1420000 }, frameworks: ["ISO/IEC 27001:2022"],
  },
  {
    code: "EXT-LAW-0001", folder: "Laws", category: "Law",
    title: "Law No. 27 of 2022 on Personal Data Protection",
    issuer: "Government of Indonesia", publisher: "Government of Indonesia",
    number: "UU 27/2022", version: "2022",
    file: { name: "UU-27-2022-PDP.pdf", size: 960000 },
    frameworks: ["ISO/IEC 27001:2022"], obligations: ["Personal Data Protection Compliance"],
  },
  {
    code: "EXT-REG-0001", folder: "Regulations", category: "Regulation",
    title: "Government Regulation No. 71 of 2019 on Electronic Systems and Transactions",
    issuer: "Government of Indonesia", number: "PP 71/2019", version: "2019",
    file: { name: "PP-71-2019.pdf", size: 870000 },
  },
  {
    code: "EXT-LET-0001", folder: "Official Letters", category: "Official Letter",
    title: "Customer Information Security Requirement Letter",
    issuer: "Key Customer", number: "CUS-SEC-REQ-2026-001",
    receivedDate: "2026-06-10T00:00:00.000Z", owner: "Jennifer Susan Walters",
    frameworks: ["ISO/IEC 27001:2022"], workUnits: ["Software Development"],
    file: { name: "customer-infosec-requirement.pdf", size: 240000 },
  },
  {
    code: "EXT-SUP-0001", folder: "Supplier Documents", category: "Supplier Document",
    title: "Cloud Hosting Service Security Whitepaper",
    issuer: "Cloud Hosting Provider", version: "2026",
    frameworks: ["ISO/IEC 27001:2022"], workUnits: ["IT Infrastructure"],
    link: "https://cloud.example.com/security-whitepaper", file: null,
  },
];

const ED_SEED_EFF = "2026-06-17T00:00:00.000Z";
const ED_SEED_NEXT = "2027-06-17T00:00:00.000Z";
const ED_SEED_ADMIN = "Tenant Administrator";

/**
 * OD `edSeedIfNeeded` (13034–13064): lazy-seed the 12 folders (with
 * descriptions) and 6 starter documents for an org on its first
 * records/record-folders read. Idempotent — an org that already has folders
 * (seeded or hand-made) is never re-seeded.
 */
export async function seedExternalDocsIfNeeded(orgId: string): Promise<void> {
  const existing = await ImplementationRecord.count({ where: { orgId, module: "record-folders" } });
  if (existing > 0) return;

  const folderIds = new Map<string, string>();
  for (const [i, [name, description]] of ED_FOLDER_SEED.entries()) {
    const folder = await ImplementationRecord.create({
      orgId, module: "record-folders", code: `EDF-${String(i + 1).padStart(4, "0")}`,
      title: name, status: "Active", owner: null, elementId: null,
      data: { description },
    });
    folderIds.set(name, folder.id);
  }

  for (const doc of ED_DOC_SEED) {
    await ImplementationRecord.create({
      orgId, module: "records", code: doc.code, title: doc.title,
      status: "Active", owner: doc.owner ?? ED_SEED_ADMIN, elementId: null,
      frameworks: doc.frameworks ?? [],
      data: {
        folderId: folderIds.get(doc.folder) ?? "", folder: doc.folder, category: doc.category,
        issuer: doc.issuer ?? "", publisher: doc.publisher ?? "", number: doc.number ?? "",
        version: doc.version ?? "", effectiveDate: "", publishedDate: "",
        receivedDate: doc.receivedDate ?? "", link: doc.link ?? "", file: doc.file ?? null,
        reviewFreq: "Annually", lastChecked: ED_SEED_EFF, nextReview: ED_SEED_NEXT,
        reviewStatus: "Current", monitorNotes: "", clauses: [],
        obligations: doc.obligations ?? [], processes: [], workUnits: doc.workUnits ?? [],
        notes: "", versionHistory: [],
      },
    });
  }
}

/** How many external documents still live in a folder (OD `edFolderCount`). */
export async function folderDocumentCount(orgId: string, folderId: string): Promise<number> {
  const rows = await ImplementationRecord.findAll({ where: { orgId, module: "records" }, attributes: ["data"] });
  return rows.filter((r) => ((r.data ?? {}) as { folderId?: string }).folderId === folderId).length;
}
