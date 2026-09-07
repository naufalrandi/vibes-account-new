import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as svc from "./personnelRecords.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const resumeSchema = z.object({
  recordType: z.string().min(1),
  title: z.string().min(1),
  // OD `personAddEdu` (modules.js:5520) `level`; `personAddTraining` (:5522) `provider`.
  level: z.string().nullish(),
  provider: z.string().nullish(),
  organization: z.string().nullish(),
  fieldOfStudy: z.string().nullish(),
  location: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  isCurrent: z.boolean().optional(),
  grade: z.string().nullish(),
  description: z.string().nullish(),
  credentialId: z.string().nullish(),
  issuer: z.string().nullish(),
  certificateNumber: z.string().nullish(),
  expiryDate: z.string().nullish(),
  attachmentUrl: z.string().nullish(),
  notes: z.string().nullish(),
});

const leaveSchema = z.object({
  leaveType: z.string().min(1),
  fromDate: z.string().min(1),
  toDate: z.string().min(1),
  // OD `personAddLeave` (modules.js:5524) writes the `lv-status` select with it.
  status: z.string().optional(),
});

// OD `personAddDisc` (modules.js:5525) writes `{date, type, severity, action, note}`
// — `di-note` is an optional textarea and there is no status field at all.
const disciplinarySchema = z.object({
  date: z.string().min(1),
  type: z.string().min(1),
  // The `di-sev` Low/Medium/High select.
  severity: z.string().nullish(),
  action: z.string().nullish(),
  note: z.string().nullish(),
});

// OD `personAddPerf` (modules.js:5526) writes `{period, rating, reviewer, note}`.
const performanceSchema = z.object({
  period: z.string().min(1),
  // The `pf-rating` Exceeds/Meets/Below select.
  rating: z.string().min(1),
  // OD reads the reviewer from a free-text `<input id="pf-rev">`; the seeded review
  // is `reviewer:'Board'` (modules.js:1078), which is a body, not a platform user.
  reviewer: z.string().nullish(),
  reviewerId: z.string().uuid().nullish(),
  note: z.string().nullish(),
});

export async function listResume(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await svc.listResumeRecords(req.auth, req.params.userId as string));
  } catch (e) {
    next(e);
  }
}

export async function createResume(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = resumeSchema.parse(req.body);
    const record = await svc.createResumeRecord(req.auth, req.params.userId as string, input, req.ip ?? null);
    sendOk(res, record, 201);
  } catch (e) {
    next(e);
  }
}

export async function deleteResume(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await svc.deleteResumeRecord(req.auth, req.params.userId as string, req.params.id as string, req.ip ?? null);
    sendOk(res, { removed: true });
  } catch (e) {
    next(e);
  }
}

export async function listLeave(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await svc.listLeaveRecords(req.auth, req.params.userId as string));
  } catch (e) {
    next(e);
  }
}

export async function createLeave(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = leaveSchema.parse(req.body);
    const record = await svc.createLeaveRecord(req.auth, req.params.userId as string, input, req.ip ?? null);
    sendOk(res, record, 201);
  } catch (e) {
    next(e);
  }
}

export async function deleteLeave(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await svc.deleteLeaveRecord(req.auth, req.params.userId as string, req.params.id as string, req.ip ?? null);
    sendOk(res, { removed: true });
  } catch (e) {
    next(e);
  }
}

export async function listDisciplinary(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await svc.listDisciplinaryRecords(req.auth, req.params.userId as string));
  } catch (e) {
    next(e);
  }
}

export async function createDisciplinary(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = disciplinarySchema.parse(req.body);
    const record = await svc.createDisciplinaryRecord(req.auth, req.params.userId as string, input, req.ip ?? null);
    sendOk(res, record, 201);
  } catch (e) {
    next(e);
  }
}

export async function deleteDisciplinary(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await svc.deleteDisciplinaryRecord(req.auth, req.params.userId as string, req.params.id as string, req.ip ?? null);
    sendOk(res, { removed: true });
  } catch (e) {
    next(e);
  }
}

export async function listPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await svc.listPerformanceRecords(req.auth, req.params.userId as string));
  } catch (e) {
    next(e);
  }
}

export async function createPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = performanceSchema.parse(req.body);
    const record = await svc.createPerformanceRecord(req.auth, req.params.userId as string, input, req.ip ?? null);
    sendOk(res, record, 201);
  } catch (e) {
    next(e);
  }
}

export async function deletePerformance(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await svc.deletePerformanceRecord(req.auth, req.params.userId as string, req.params.id as string, req.ip ?? null);
    sendOk(res, { removed: true });
  } catch (e) {
    next(e);
  }
}
