import type { LimsStageState, StageConfig } from "../../db/models/testingService.model";

/** The 10 fixed base stages, in order (LIMS_BASE). */
export const LIMS_BASE = [
  "Inquiry",
  "Quotation",
  "Contract / Work Order",
  "Sample Receipt",
  "Sample Registration",
  "Sample Review & Acceptance",
  "Testing",
  "Technical Review",
  "Authorization",
  "Report Issuance",
] as const;

/** The 5 configurable stages (key → label), LIMS_STAGE_DEFS. */
export const LIMS_STAGE_DEFS: { key: string; label: string }[] = [
  { key: "planning", label: "Sampling Planning" },
  { key: "sampling", label: "Sampling" },
  { key: "cert", label: "Certificate Issuance" },
  { key: "retention", label: "Sample Retention" },
  { key: "disposal", label: "Sample Disposal" },
];

export const LIMS_STATES: LimsStageState[] = ["Mandatory", "Optional", "Not Applicable"];

const LABEL: Record<string, string> = Object.fromEntries(LIMS_STAGE_DEFS.map((s) => [s.key, s.label]));

/** A configurable stage is active when Mandatory, or Optional and toggled on. */
function active(state: LimsStageState | undefined, key: string, selected: string[]): boolean {
  return state === "Mandatory" || (state === "Optional" && selected.includes(key));
}

/**
 * Generate the ordered workflow for a service (`limsGenerate`):
 * base 1–3 → [planning] → [sampling, else Sample Receipt] → base 5–10 →
 * [cert] → [retention] → [disposal]. The Sampling stage supplants Sample Receipt.
 */
export function limsGenerate(stages: StageConfig, selected: string[] = []): string[] {
  const out: string[] = [LIMS_BASE[0], LIMS_BASE[1], LIMS_BASE[2]];
  if (active(stages.planning, "planning", selected)) out.push(LABEL.planning);
  if (active(stages.sampling, "sampling", selected)) out.push(LABEL.sampling);
  else out.push(LIMS_BASE[3]); // Sample Receipt
  out.push(LIMS_BASE[4], LIMS_BASE[5], LIMS_BASE[6], LIMS_BASE[7], LIMS_BASE[8], LIMS_BASE[9]);
  if (active(stages.cert, "cert", selected)) out.push(LABEL.cert);
  if (active(stages.retention, "retention", selected)) out.push(LABEL.retention);
  if (active(stages.disposal, "disposal", selected)) out.push(LABEL.disposal);
  return out;
}

/** The static workflow catalog returned by GET /v1/lims/workflow-config. */
export function workflowConfig() {
  return {
    baseStages: [...LIMS_BASE],
    configurableStages: LIMS_STAGE_DEFS,
    states: LIMS_STATES,
  };
}

/** Normalize a partial stage config to all 5 keys (default Not Applicable). */
export function normalizeStages(stages: Partial<StageConfig> | undefined): StageConfig {
  const out: StageConfig = {};
  for (const { key } of LIMS_STAGE_DEFS) {
    const v = stages?.[key];
    out[key] = v && LIMS_STATES.includes(v) ? v : "Not Applicable";
  }
  return out;
}
