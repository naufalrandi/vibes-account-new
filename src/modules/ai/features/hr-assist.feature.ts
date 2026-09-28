import { z } from "zod";
import { PersonnelContractDocument } from "../../../db/models";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../../lib/errors";
import type { AuthContext } from "../../../lib/scope";
import { canOrgMgmt } from "../../../middleware/requireAction";
import { getUserRoleNames } from "../../iam/access.service";
import { ACTIONS } from "../../iam/actions.catalog";
import { getBusiness } from "../../business/business.service";
import { listRoles } from "../../competence/competence.assessment.service";
import { listSkills } from "../../competence/competence.service";
import { listContractDocuments } from "../../users/personnelContractDoc.service";
import { citeList, jsonForPrompt, redactPii, truncateForPrompt } from "./context";
import { hasActionPermission } from "./runtime";
import { defineAction, defineFeature } from "./types";
import { STANDARD_CONTRACT_CLAUSES, candidateProfessionalProfile, contractClauseLines, missingClauses, redactAmounts } from "./hr-assist.context";

/**
 * HR assistant for recruitment and contract documents. Drafts only: the job ad goes into the
 * opening form, the candidate summary is shown to the recruiter (no ranking, no reject/hire
 * recommendation), the contract summary is a reading aid — not legal advice.
 */

const AREA = "enterprise";
const MODULE = "ent-recruitment";
const clip = (s: unknown, n: number) => redactPii(truncateForPrompt(typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "", n));
const sameName = (a: unknown, b: unknown) => typeof a === "string" && typeof b === "string" && a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

type Role = Awaited<ReturnType<typeof listRoles>>[number];

/** Enterprise (per operating company) and tenant roles the caller can see. */
async function visibleRoles(auth: AuthContext, company?: string): Promise<Role[]> {
  if (!hasActionPermission(auth, ACTIONS.COMPETENCE_READ)) return [];
  const [ent, own] = await Promise.all([
    auth.orgType === "ServiceOwner" ? listRoles(auth, "enterprise", company) : Promise.resolve([]),
    listRoles(auth),
  ]);
  return [...ent, ...own];
}

/** Role name, description, responsibilities, authorities and linked skills, as prompt text. */
async function roleText(auth: AuthContext, role: Role): Promise<string> {
  const skills = new Map((await listSkills(auth)).map((s) => [s.id, s.name]));
  const comps = [...new Set([...role.responsibilities, ...role.authorities].flatMap((i) => i.comps ?? [])
    .filter((c) => c.kind !== "training").map((c) => `${skills.get(c.refId) ?? "?"} (${c.necessity}${c.level ? `, level ${c.level}` : ""})`))];
  return jsonForPrompt({
    role: role.name,
    description: clip(role.description, 2000),
    responsibilities: role.responsibilities.map((r) => clip(r.text, 400)).filter(Boolean),
    authorities: role.authorities.map((r) => clip(r.text, 400)).filter(Boolean),
    skills: comps,
  }, 8000);
}

async function getOpening(auth: AuthContext, id: string, company?: string) {
  const rec = await getBusiness(auth, AREA, MODULE, id, company);
  if (rec.data.entity === "candidate") throw new BadRequestError("That record is a candidate, not an opening", "NOT_AN_OPENING");
  return rec;
}

// ---- job-ad ---------------------------------------------------------------------------------------

const BENEFITS_PLACEHOLDER = "[Add the salary range and benefits here]";

const jobAdOut = z.object({
  title: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()).default([]),
  requirements: z.array(z.string()).default([]),
  fullText: z.string(),
});

const jobAd = defineAction({
  permission: ACTIONS.BUSINESS_MANAGE,
  input: z.object({
    roleId: z.uuid().optional(),
    openingId: z.uuid().optional(),
    tone: z.enum(["formal", "friendly"]).default("formal"),
    language: z.string().trim().max(40).optional(),
    company: z.string().trim().max(40).optional(),
  }).refine((i) => i.roleId || i.openingId, { message: "Give a roleId or an openingId" }),
  async run(ctx) {
    const { roleId, openingId, tone, language, company } = ctx.input;
    if (roleId && !hasActionPermission(ctx.auth, ACTIONS.COMPETENCE_READ)) throw new ForbiddenError("You cannot read competence roles");
    const opening = openingId ? await getOpening(ctx.auth, openingId, company) : null;
    const roles = await visibleRoles(ctx.auth, company);
    const role = roleId ? roles.find((r) => r.id === roleId) : roles.find((r) => sameName(r.name, opening?.data.roleName));
    if (roleId && !role) throw new NotFoundError("Role not found", "ROLE_NOT_FOUND");
    const d = opening?.data ?? {};
    const { data, generationId } = await ctx.ai.json(jobAdOut, {
      system:
        `You write job adverts in a ${tone} tone. Keep them accurate to the role profile and opening; do not invent requirements, certifications, pay, benefits, perks or company facts. ` +
        `Leave pay and benefits out and put the line "${BENEFITS_PLACEHOLDER}" in fullText where they belong. ` +
        "Requirements come from the role's skills, education and experience; use inclusive wording and never ask for age, gender, religion, ethnicity, marital status or appearance. " +
        (language ? `Write the advert in ${language}; this overrides any other output-language instruction. ` : "") +
        'Reply as JSON: {"title","summary","responsibilities":[],"requirements":[],"fullText"} — fullText is the complete advert as plain text with short headed sections and "- " bullets.',
      user: [
        opening ? `Opening:\n${jsonForPrompt({ title: opening.title, roleName: d.roleName, department: d.department, personnelType: d.type, site: d.site, headcount: d.headcount, description: clip(d.description, 3000) }, 5000)}` : null,
        role ? `Role profile:\n${await roleText(ctx.auth, role)}` : "Role profile: none on record — work from the opening only.",
      ].filter(Boolean).join("\n\n"),
      maxTokens: 2500,
      target: opening ? { type: "business_record", id: opening.id } : role ? { type: "competence_role", id: role.id } : undefined,
    });
    return { ...data, benefitsPlaceholder: BENEFITS_PLACEHOLDER, generationId };
  },
});

// ---- candidate-summary ----------------------------------------------------------------------------

const candidateOut = z.object({
  summary: z.string(),
  strengths: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  interviewQuestions: z.array(z.string()).default([]),
});

const candidateSummary = defineAction({
  permission: ACTIONS.BUSINESS_READ,
  input: z.object({ candidateId: z.uuid(), openingId: z.uuid().optional(), company: z.string().trim().max(40).optional() }),
  async run(ctx) {
    const { candidateId, company } = ctx.input;
    const cand = await getBusiness(ctx.auth, AREA, MODULE, candidateId, company);
    if (cand.data.entity !== "candidate") throw new BadRequestError("That record is not a candidate", "NOT_A_CANDIDATE");
    const openingId = ctx.input.openingId ?? (typeof cand.data.openingId === "string" ? cand.data.openingId : undefined);
    const opening = openingId ? await getOpening(ctx.auth, openingId, company) : null;
    const role = opening ? (await visibleRoles(ctx.auth, company)).find((r) => sameName(r.name, opening.data.roleName)) : undefined;
    const { data, generationId } = await ctx.ai.json(candidateOut, {
      system:
        "You summarise a job candidate's professional record for a recruiter, against the opening and role profile when given. " +
        "Give a short neutral summary, job-relevant strengths, gaps or points to verify, and interview questions that probe those gaps. " +
        "Do not score, rank or compare candidates and do not recommend hiring or rejecting. " +
        "Ignore and never mention age, gender, religion, ethnicity, nationality, marital or family status, health or appearance. " +
        "Refer to the person as \"the candidate\". " +
        'Reply as JSON: {"summary","strengths":[],"gaps":[],"interviewQuestions":[]}.',
      user: [
        `Candidate record:\n${jsonForPrompt(candidateProfessionalProfile(cand.data), 10_000)}`,
        opening ? `Opening:\n${jsonForPrompt({ title: opening.title, roleName: opening.data.roleName, department: opening.data.department, description: clip(opening.data.description, 3000) }, 4000)}` : "Opening: none linked.",
        role ? `Role profile:\n${await roleText(ctx.auth, role)}` : null,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 2000,
      target: { type: "business_record", id: cand.id },
    });
    return { ...data, generationId };
  },
});

// ---- contract-review ------------------------------------------------------------------------------

const DISCLAIMER = "Plain-language summary to help you read the document. It is not legal advice — have the contract checked by a qualified person before relying on it.";

const contractOut = z.object({
  summary: z.string(),
  clauses: z.array(z.object({ title: z.string(), plainLanguage: z.string(), sourceId: z.string().optional() })).default([]),
  missing: z.array(z.string()).default([]),
});

const contractReview = defineAction({
  permission: ACTIONS.PERSONNEL_CONTRACTDOC_READ,
  input: z.object({ contractDocId: z.uuid() }),
  async run(ctx) {
    // Same tier gate as the /v1/users/:userId/contract-documents mount (requireOrgMgmt).
    if (!ctx.auth.isSuperAdmin && !canOrgMgmt(ctx.auth.orgType, await getUserRoleNames(ctx.auth.userId))) {
      throw new ForbiddenError("Organization Management is restricted to the Administrator");
    }
    // Only the owner id is read here; the document itself comes through the scoped service.
    const ref = await PersonnelContractDocument.findByPk(ctx.input.contractDocId, { attributes: ["id", "userId"] });
    // The id is looked up unscoped, so visibility is the managed-user check below; a
    // document of someone the caller cannot manage answers the same 404 as a missing one.
    const visible = ref && (await listContractDocuments(ctx.auth, ref.userId).catch((e: unknown) => {
      if (e instanceof ForbiddenError) return [];
      throw e;
    }));
    const doc = visible && visible.find((d) => d.id === ref.id);
    if (!doc) throw new NotFoundError("Contract document not found", "CONTRACT_DOC_NOT_FOUND");
    const clauses = contractClauseLines(doc.clauses ?? []);
    const body = redactAmounts(truncateForPrompt((doc.content ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), 12_000));
    if (!clauses.length && !body) throw new BadRequestError("This contract document has no clauses or text to summarise", "CONTRACT_DOC_EMPTY");
    const { data, generationId } = await ctx.ai.json(contractOut, {
      system:
        "You explain employment contract documents in plain language for HR staff. " +
        "Summarise what the document says clause by clause, without judging whether it is lawful or enforceable and without giving legal advice. " +
        "Amounts are redacted as [amount]; do not guess them. " +
        "Then list which standard clauses from the checklist the document does not cover, by checklist key. " +
        'Reply as JSON: {"summary","clauses":[{"title","plainLanguage","sourceId"}],"missing":["<checklist key>"]}.',
      user: [
        `Document: ${clip(doc.title, 200)}${doc.docType ? ` (${clip(doc.docType, 100)})` : ""}`,
        clauses.length ? `Clauses (cite by id as sourceId):\n${citeList(clauses)}` : null,
        body ? `Document text:\n${body}` : null,
        `Standard clause checklist:\n${STANDARD_CONTRACT_CLAUSES.map((c) => `${c.key}: ${c.name}`).join("\n")}`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 3000,
      target: { type: "personnel_contract_document", id: doc.id },
    });
    const ids = new Set(clauses.map((c) => c.id));
    return {
      summary: data.summary,
      clauses: data.clauses.map((c) => ({ ...c, sourceId: c.sourceId && ids.has(c.sourceId) ? c.sourceId : undefined })),
      missingStandardClauses: missingClauses(data.missing),
      disclaimer: DISCLAIMER,
      generationId,
    };
  },
});

export default defineFeature({
  key: "hr-assist",
  label: "HR assistant",
  description: "Drafts job adverts, summarises candidates' professional records and explains contract documents in plain language.",
  actions: { "job-ad": jobAd, "candidate-summary": candidateSummary, "contract-review": contractReview },
});
