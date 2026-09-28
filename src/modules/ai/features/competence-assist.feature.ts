import { z } from "zod";
import { ForbiddenError, NotFoundError } from "../../../lib/errors";
import { ACTIONS } from "../../iam/actions.catalog";
import { listSkills } from "../../competence/competence.service";
import { getPendingExamAttempt } from "../../competence/competence.instrument.service";
import { PROF_LEVELS } from "../../../db/models/competence.models";
import { EXAM_BANK, ISCEDF, ISIC, ROLE_SUGGESTIONS } from "../../reference/reference.data";
import { getProcessById } from "../../processes/process.service";
import { listMyFrameworks } from "../../frameworks/myFramework.service";
import { getRequirement } from "../../frameworks/requirement.service";
import { listRecords } from "../../implementation/implementation.service";
import { citeList, jsonForPrompt, redactPii, truncateForPrompt } from "./context";
import { hasActionPermission } from "./runtime";
import { defineAction, defineFeature, type AiActionContext } from "./types";
import {
  closestArchetypes, fewShotFromBank, sanitizeGrades, sanitizeRoleDraft, toAwarenessQuestions, toExamQuestions,
  type ExamItemType, type GeneratedExamItem,
} from "./competence-assist.context";

/**
 * Competence assistant. Every action returns a draft; the client applies it through the normal
 * competence / awareness endpoints (role editor, exam editor, grading form, quiz editor).
 * Nothing is saved here, and suggested grades never finalize an attempt.
 */

const line = z.string().trim().max(1000);
const clip = (s: string | null | undefined, n: number) => redactPii(truncateForPrompt((s ?? "").replace(/\s+/g, " ").trim(), n));

// ---- role-draft -----------------------------------------------------------------------------------

const ISCED_FIELDS = ISCEDF;
const ISIC_TOP = ISIC.filter((n) => n.level === "section" || n.level === "division");

const roleDraftOut = z.object({
  description: z.string().default(""),
  responsibilities: z.array(z.string()).default([]),
  authorities: z.array(z.string()).default([]),
  skills: z.array(z.object({ name: z.string(), level: z.coerce.number() })).default([]),
  eduFields: z.array(z.string()).default([]),
  expReqs: z.array(z.object({ sector: z.string(), years: z.coerce.number() })).default([]),
});

const roleDraft = defineAction({
  permission: ACTIONS.COMPETENCE_MANAGE,
  input: z.object({
    roleName: z.string().trim().min(1).max(200),
    currentDraft: z.object({
      description: z.string().max(5000).optional(),
      responsibilities: z.array(line).max(100).optional(),
      authorities: z.array(line).max(100).optional(),
    }).optional(),
    context: z.object({
      processIds: z.array(z.uuid()).max(10).optional(),
      workUnit: z.string().trim().max(200).optional(),
      frameworks: z.array(z.string().trim().max(200)).max(10).optional(),
    }).optional(),
  }),
  async run(ctx) {
    const { roleName, currentDraft = {}, context = {} } = ctx.input;
    const processIds = context.processIds ?? [];
    if (processIds.length && !hasActionPermission(ctx.auth, ACTIONS.PROCESS_READ)) throw new ForbiddenError("You cannot read business processes");
    const [skills, frameworks, processes] = await Promise.all([
      listSkills(ctx.auth),
      context.frameworks?.length ? Promise.resolve(context.frameworks) : listMyFrameworks(ctx.auth).then((fs) => fs.map((f) => f.frameworkName)),
      Promise.all(processIds.map((id) => getProcessById(ctx.auth, id))),
    ]);
    const examples = closestArchetypes(roleName, ROLE_SUGGESTIONS);
    const skillNames = skills.map((s) => s.name);

    const { data, generationId } = await ctx.ai.json(roleDraftOut, {
      system:
        "You draft competence role profiles (ISO 9001 7.2 / ISO 27001 7.2 style) for a management-system platform. " +
        "Write a one-paragraph role description, concrete responsibilities and authorities (one sentence each, imperative), " +
        "the skills the role needs with a proficiency level 1-4 (1 Awareness, 2 Working, 3 Proficient, 4 Expert), " +
        "ISCED-F field-of-study codes and ISIC sector experience requirements. " +
        "Use skill names exactly as written in the skill library whenever one fits. Use only codes from the lists given. " +
        "Do not repeat anything already in the current draft. Ground the lines in the organisation's processes and frameworks when given. " +
        'Reply as JSON: {"description","responsibilities":[],"authorities":[],"skills":[{"name","level"}],"eduFields":[],"expReqs":[{"sector","years"}]}.',
      user: [
        `Role name: ${roleName}`,
        context.workUnit ? `Work unit: ${context.workUnit}` : null,
        `Frameworks: ${frameworks.join(", ") || "(none on record)"}`,
        processes.length ? `Processes:\n${processes.map((p) => `- ${p.name}: ${clip(p.description, 400)}${p.steps.length ? ` Steps: ${p.steps.map((s) => s.name).join("; ")}` : ""}`).join("\n")}` : null,
        `Current draft (do not repeat):\n${jsonForPrompt({ description: currentDraft.description ?? "", responsibilities: currentDraft.responsibilities ?? [], authorities: currentDraft.authorities ?? [] }, 6000)}`,
        examples.length ? `Example role profiles from the curated library:\n${jsonForPrompt(examples.map((e) => ({ name: e.name, frameworks: e.frameworks, description: e.description, responsibilities: e.responsibilities, authorities: e.authorities })), 6000)}` : null,
        `Other curated role names: ${ROLE_SUGGESTIONS.map((r) => r.name).join(", ")}`,
        `Skill library: ${truncateForPrompt(skillNames.join("; "), 8000)}`,
        `ISCED-F fields:\n${ISCED_FIELDS.map((n) => `${n.code} ${n.label}`).join("\n")}`,
        `ISIC sectors:\n${truncateForPrompt(ISIC_TOP.map((n) => `${n.code} ${n.label}`).join("\n"), 8000)}`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 3000,
    });
    const result = sanitizeRoleDraft(data, currentDraft, {
      skillNames,
      eduCodes: new Set(ISCED_FIELDS.map((n) => n.code)),
      sectorCodes: new Set(ISIC_TOP.map((n) => n.code)),
    });
    const eduLabel = new Map(ISCED_FIELDS.map((n) => [n.code, n.label]));
    const sectorLabel = new Map(ISIC_TOP.map((n) => [n.code, n.label]));
    return {
      ...result,
      eduFields: result.eduFields.map((code) => ({ code, label: eduLabel.get(code) ?? "" })),
      expReqs: result.expReqs.map((e) => ({ ...e, label: sectorLabel.get(e.sector) ?? "" })),
      examples: examples.map((e) => e.name),
      generationId,
    };
  },
});

// ---- exam-items -----------------------------------------------------------------------------------

const examItemsInput = (max: number) => z.object({
  skill: z.string().trim().min(1).max(200),
  level: z.number().int().min(1).max(4),
  count: z.number().int().min(1).max(max),
  type: z.enum(["mcq", "short", "mixed"]),
  referenceIds: z.array(z.uuid()).max(10).optional(),
  /** Question texts already in the exam, so none are repeated. */
  existing: z.array(z.string().max(2000)).max(300).optional(),
});
type ExamItemsInput = z.infer<ReturnType<typeof examItemsInput>>;

const examItemsOut = z.object({
  items: z.array(z.object({
    type: z.string(),
    question: z.string(),
    options: z.array(z.object({ text: z.string(), correct: z.boolean() })).optional(),
    answerTrue: z.boolean().optional(),
    modelAnswer: z.string().optional(),
    points: z.coerce.number().optional(),
    ref: z.string().optional(),
    explanation: z.string().optional(),
    sourceIds: z.array(z.string()).optional(),
  })).default([]),
});

const BATCH = 10;
const TYPE_RULE: Record<ExamItemType, string> = {
  mcq: 'Use only "single" (one correct option), "multi" (one or more correct options) and "truefalse" questions.',
  short: 'Use only "short" questions, each with a model answer the assessor grades against.',
  mixed: 'Mix "single", "multi", "truefalse" and "short" questions.',
};

async function generateExamItems(ctx: AiActionContext<ExamItemsInput>) {
  const { skill, level, count, type, referenceIds = [], existing = [] } = ctx.input;
  const refs = await Promise.all(referenceIds.map((id) => getRequirement(ctx.auth, id)));
  const sources = refs.map((r) => ({ id: r.id, text: `${r.frameworkName} ${r.code} ${r.subject}: ${clip(r.description, 800)}` }));
  const bankKey = Object.keys(EXAM_BANK).find((k) => k.toLowerCase() === skill.toLowerCase());
  const shots = fewShotFromBank(EXAM_BANK[bankKey ?? "Internal Auditing"]?.levels, level, type);
  const items: GeneratedExamItem[] = [];
  const generationIds: string[] = [];
  const total = Math.ceil(count / BATCH);
  for (let b = 0; b < total && items.length < count; b++) {
    const want = Math.min(BATCH, count - items.length);
    const { data, generationId } = await ctx.ai.json(examItemsOut, {
      system:
        "You write competence exam questions for a management-system competence programme. " +
        `Target level ${level} (${PROF_LEVELS[level]}): 1 = recall of terms, 2 = applying them in everyday work, 3 = analysing situations and judging evidence, 4 = expert judgement. ` +
        `${TYPE_RULE[type]} Each question tests one idea, has plausible distractors and no "all of the above". ` +
        '"ref" names the standard or source the question relies on; give clause numbers only if they appear in the sources. ' +
        'Reply as JSON: {"items":[{"type","question","options":[{"text","correct"}],"answerTrue","modelAnswer","points","ref","explanation","sourceIds":[]}]}.',
      user: [
        `Skill: ${skill}`,
        `Write ${want} new questions.`,
        sources.length ? `Sources (cite by id in sourceIds):\n${citeList(sources)}` : "Sources: none given — rely on general knowledge of the relevant standards.",
        shots.length ? `Examples of the question bank's style (t: single/multi/tf/short, o: [text, correct], a: true/false answer, m: model answer, p: points):\n${jsonForPrompt(shots, 4000)}` : null,
        `Do not repeat these questions:\n${truncateForPrompt([...existing, ...items.map((i) => i.text)].join("\n") || "(none)", 6000)}`,
      ].filter(Boolean).join("\n\n"),
      maxTokens: 4000,
    });
    generationIds.push(generationId);
    items.push(...toExamQuestions(data.items, type, new Set(referenceIds), [...existing, ...items.map((i) => i.text)]).slice(0, want));
    await ctx.progress?.(b + 1, total);
  }
  return { items, sources: refs.map((r) => ({ id: r.id, label: `${r.frameworkName} ${r.code} ${r.subject}` })), generationIds };
}

/** Up to 10 questions, answered in the request. */
const examItems = defineAction({ permission: ACTIONS.COMPETENCE_MANAGE, input: examItemsInput(BATCH), run: generateExamItems });
/** Up to 30 questions, as a background job (the client picks this action when count > 10). */
const examItemsBulk = defineAction({ permission: ACTIONS.COMPETENCE_MANAGE, mode: "job", input: examItemsInput(30), run: generateExamItems });

// ---- grade-short-answers --------------------------------------------------------------------------

const gradeOut = z.object({
  grades: z.array(z.object({ questionId: z.string(), suggestedScore: z.coerce.number(), rationale: z.string() })).default([]),
});

const gradeShortAnswers = defineAction({
  permission: ACTIONS.COMPETENCE_MANAGE,
  input: z.object({ attemptId: z.uuid() }),
  async run(ctx) {
    const { row, inst } = await getPendingExamAttempt(ctx.auth, ctx.input.attemptId);
    const shorts = inst.questions.filter((q) => q.type === "short");
    if (!shorts.length) return { suggestions: [], generationId: null };
    const answers = row.answers as Record<string, unknown>;
    const { data, generationId } = await ctx.ai.json(gradeOut, {
      system:
        "You help an assessor grade short written exam answers against the model answer. " +
        "For each question suggest whole points between 0 and the maximum, and a one- or two-sentence rationale naming what the answer covers or misses compared with the model answer. " +
        "Judge content only, not spelling or style. An empty answer gets 0. The assessor decides the final grade. " +
        'Reply as JSON: {"grades":[{"questionId","suggestedScore","rationale"}]}.',
      user: shorts.map((q) => jsonForPrompt({
        questionId: q.id, question: q.text, maxPoints: q.points,
        modelAnswer: clip(q.model, 2000) || "(no model answer stored — grade on correctness only and say so)",
        answer: clip(typeof answers[q.id] === "string" ? (answers[q.id] as string) : "", 3000) || "(no answer)",
      }, 6000)).join("\n"),
      maxTokens: 2000,
      target: { type: "competence_exam_attempt", id: row.id },
    });
    return { suggestions: sanitizeGrades(data.grades, shorts), generationId };
  },
});

// ---- awareness-quiz -------------------------------------------------------------------------------

const quizOut = z.object({
  items: z.array(z.object({
    type: z.string(),
    question: z.string(),
    options: z.array(z.object({ text: z.string(), correct: z.boolean() })).optional(),
    answerTrue: z.boolean().optional(),
  })).default([]),
});

const awarenessQuiz = defineAction({
  permission: ACTIONS.MS_MANAGE,
  input: z.object({
    topicId: z.uuid().optional(),
    text: z.string().trim().max(20_000).optional(),
    count: z.number().int().min(1).max(20).default(5),
  }).refine((i) => i.topicId || i.text, { message: "Give a topicId or text" }),
  async run(ctx) {
    const { topicId, text, count } = ctx.input;
    let material = text ? clip(text, 12_000) : "";
    let topicTitle = "";
    if (topicId) {
      const topic = (await listRecords(ctx.auth, "awareness-topics")).find((r) => r.id === topicId);
      if (!topic) throw new NotFoundError("Awareness topic not found", "RECORD_NOT_FOUND");
      const d = topic.data as Record<string, unknown>;
      const s = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : "");
      topicTitle = topic.title;
      material = [`Topic: ${topic.title}`, s("category") && `Category: ${s("category")}`, s("summary") && `Summary: ${clip(s("summary"), 4000)}`,
        s("keyMessages") && `Key messages: ${clip(s("keyMessages"), 4000)}`, material].filter(Boolean).join("\n");
    }
    const { data, generationId } = await ctx.ai.json(quizOut, {
      system:
        "You write short awareness-check quizzes for staff after an awareness campaign. " +
        'Use "single" questions (3-4 options, exactly one correct) and "truefalse" questions. ' +
        "Test the key messages and the behaviour expected of staff, in plain language, based only on the material. " +
        'Reply as JSON: {"items":[{"type","question","options":[{"text","correct"}],"answerTrue"}]}.',
      user: `Write ${count} questions.\n\nMaterial:\n${material}`,
      maxTokens: 2500,
      target: topicId ? { type: "awareness_topic", id: topicId } : undefined,
    });
    return { topicTitle, questions: toAwarenessQuestions(data.items).slice(0, count), generationId };
  },
});

export default defineFeature({
  key: "competence-assist",
  label: "Competence assistant",
  description: "Drafts role profiles, exam questions and awareness quizzes, and suggests grades for short written answers.",
  actions: {
    "role-draft": roleDraft,
    "exam-items": examItems,
    "exam-items-bulk": examItemsBulk,
    "grade-short-answers": gradeShortAnswers,
    "awareness-quiz": awarenessQuiz,
  },
});
