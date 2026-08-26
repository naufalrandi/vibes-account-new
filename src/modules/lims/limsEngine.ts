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

/**
 * OD's LIMS area map (`LIMSCFG()` / `LIMS_VIEWS` / `limsPlaceholder`,
 * core.js:22382-22422) — 5 rail sections, 7 views.
 *
 * This is the backend home of the `tn-m-lab-operations` tenant module. OD does
 * not render that module as a clause register: `core.js:8951` dispatches it to
 * `setPlat('axia','lims')`, the whole LIMS platform area, so an `MS_MODULES`
 * entry would be a fake home (see the note in `implementation/registry.ts`).
 * What the module actually resolves to is this area, and the three views under
 * Testing Management are its entire implemented surface — `renderTestingServices`
 * (testing-service master data), `renderWorkflowConfig` (per-service stage
 * matrix, saved through `tsSetStage` → PUT /testing-services/:id) and
 * `renderWorkflowPreview` (generated, never persisted). The other four are
 * `limsPlaceholder` "Under Development" empty states in OD itself: no fields,
 * no entities, no save path. `db.samples` / `db.testOrders` and the rest of an
 * operational sample-intake entity set do not exist anywhere in the design
 * source — `lims-samples`/`lims-tests`/`lims-methods`/`lims-results`/
 * `lims-reports` appear only as `AC_UNITS` permission keys (core.js:5020), a
 * per-unit access-control surface with no render function behind it. So
 * `implemented: false` is the honest server-side statement, and nothing here
 * invents tables the design never draws.
 */
export const LIMS_AREA_KEY = "lims";
/** The OD nav key this area serves (core.js:2634). */
export const LIMS_MODULE_KEY = "tn-m-lab-operations";

const SHELL_SUB = "LIMS · AXIA — Laboratory Information Management System";

export interface LimsView {
  key: string;
  label: string;
  /** OD `toolbar({title,sub})` for the view. */
  title: string;
  sub: string;
  /** False for OD's own `limsPlaceholder` "Under Development" views. */
  implemented: boolean;
  /** OD's placeholder blurb; only set on unimplemented views. */
  description?: string;
  /** The endpoints backing the view; empty for placeholders. */
  endpoints: string[];
}

export interface LimsSection {
  key: string;
  label: string;
  views: LimsView[];
}

const placeholder = (key: string, label: string, description: string): LimsView => ({
  key, label, title: label, sub: SHELL_SUB, implemented: false, description, endpoints: [],
});

export const LIMS_SECTIONS: LimsSection[] = [
  {
    key: "calibration", label: "Calibration Management",
    views: [placeholder("lims-calibration", "Calibration Management", "Equipment calibration scheduling, records and certificates.")],
  },
  {
    key: "testing", label: "Testing Management",
    views: [
      {
        key: "lims-services", label: "Testing Services",
        title: "Testing Services", sub: "LIMS · platform master data — laboratory service lines",
        implemented: true, endpoints: ["/v1/lims/testing-services"],
      },
      {
        key: "lims-workflow", label: "Workflow Configuration",
        title: "Workflow Configuration", sub: "LIMS · configure workflow stages per Testing Service",
        implemented: true, endpoints: ["/v1/lims/workflow-config", "/v1/lims/testing-services/:id"],
      },
      {
        key: "lims-preview", label: "Workflow Preview",
        title: "Workflow Preview", sub: "LIMS · dynamically generated workflow per Testing Service",
        implemented: true, endpoints: ["/v1/lims/workflow-preview"],
      },
    ],
  },
  {
    key: "equipment", label: "Equipment Management",
    views: [placeholder("lims-equipment", "Equipment Management", "Laboratory equipment inventory, status and maintenance.")],
  },
  {
    key: "customers", label: "Customer Management",
    views: [placeholder("lims-customers", "Customer Management", "Laboratory customers and submitting organizations.")],
  },
  {
    key: "reporting", label: "Reporting",
    views: [placeholder("lims-reporting", "Reporting", "Test reports and certificate generation.")],
  },
];

/** OD `LIMS_VIEWS` (core.js:22393), in rail order. */
export const LIMS_VIEWS: string[] = LIMS_SECTIONS.flatMap((s) => s.views.map((v) => v.key));

/** OD's landing view when `route.view` is not a LIMS view (core.js:22406). */
export const LIMS_DEFAULT_VIEW = "lims-services";

/** The area descriptor served by GET /v1/lims/area. */
export function areaMap() {
  return {
    area: LIMS_AREA_KEY,
    platform: "axia",
    moduleKey: LIMS_MODULE_KEY,
    label: "Laboratory Operations (LIMS)",
    defaultView: LIMS_DEFAULT_VIEW,
    sections: LIMS_SECTIONS,
    views: LIMS_VIEWS,
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
