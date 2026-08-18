/**
 * Row shapes for the generated OD compliance-engine seed data
 * (complianceEngine.*.data.ts). All references are natural keys — framework
 * name, requirement code, FWE code, CQ/CQR code — resolved to DB ids by
 * seedComplianceEngine() at seed time.
 */

export interface CeFramework {
  name: string;
  /** Framework group name ("Standards" | "Regulations"). */
  group: string;
  description: string;
  /** Only Regulations carry jurisdictions in OD (GDPR/DORA → ["EU"]). */
  jurisdictions: string[];
}

export interface CeRequirement {
  /** Framework name (natural key into CE_FRAMEWORKS). */
  framework: string;
  code: string;
  subject: string;
  description: string;
  /** OD classifyReqArray(): parent clauses are Headers, leaf clauses Assessable. */
  type: "Header" | "Assessable";
}

export interface CeElement {
  /** Stable FWE code (FWE-001..FWE-027) — the update-by-position key. */
  code: string;
  name: string;
  description: string;
  category: "Core" | "Framework Extension";
}

export interface CeQuestion {
  /** Owning FWE code. */
  element: string;
  /** OD CQ code: CQ-<elemNum>-NN — globally unique, the upsert key. */
  code: string;
  title: string;
  text: string;
  category: string;
  dimension: "Coverage" | "Maturity";
  order: number;
}

export interface CeResponse {
  /** Owning CQ code. */
  question: string;
  /** OD CQR code: <CQ code>-Rn — globally unique, the upsert key. */
  code: string;
  text: string;
  order: number;
  /** true → picking this response reveals the framework picker (OD `child:'frameworks'`). */
  child: boolean;
}

export interface CeCriterion {
  framework: string;
  /** Requirement code within the framework. */
  requirement: string;
  score: number;
  description: string;
}

/**
 * One FWRC row: [frameworkName, requirementCode, responseCode, statement].
 * The FWRC code is positional (`FWRC-<index+1>` padded to 4 digits — OD's
 * fwrcAssignCodes) and the element/question are derived from the response code.
 */
export type CeFwrcRow = readonly [string, string, string, string];
