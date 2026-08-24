import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./implementation.service";
import * as docControl from "./documentControl";
import * as awControl from "./awarenessControl";
import * as trainingLifecycle from "./trainingLifecycle";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const inputSchema = z.object({
  title: z.string().max(300).optional(),
  status: z.string().max(80).optional(),
  owner: z.string().max(200).nullish(),
  data: z.record(z.string(), z.unknown()).optional(),
  elementId: z.string().uuid().nullish(),
  frameworks: z.array(z.string()).optional(),
});

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    const rows = await service.listRecords(req.auth, req.params.module as string, { orgId });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = inputSchema.parse(req.body);
    const orgId = typeof req.query.orgId === "string" ? req.query.orgId : undefined;
    sendOk(res, await service.createRecord(req.auth, req.params.module as string, input, orgId, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = inputSchema.parse(req.body);
    sendOk(res, await service.updateRecord(req.auth, req.params.module as string, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteRecord(req.auth, req.params.module as string, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}

// --- Controlled-document settings (OD `cdSettings`) --------------------------
const docSettingsSchema = z.record(z.string(), z.unknown());

export async function getDocumentSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await docControl.getDocSettings(req.auth.orgId));
  } catch (e) {
    next(e);
  }
}

export async function putDocumentSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = docSettingsSchema.parse(req.body);
    sendOk(res, await docControl.setDocSettings(req.auth, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

// --- Awareness settings + campaign launch/ack/eval (OD `aw*` app.html:25297–25867) ----

const awSettingsSchema = z.record(z.string(), z.unknown());

export async function getAwarenessSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await awControl.getAwSettings(req.auth.orgId));
  } catch (e) {
    next(e);
  }
}

export async function putAwarenessSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = awSettingsSchema.parse(req.body);
    sendOk(res, await awControl.setAwSettings(req.auth, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function launchAwarenessCampaign(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await awControl.launchCampaign(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function acknowledgeAwarenessAck(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await awControl.acknowledgeAck(req.auth, req.params.id as string, req.params.ackId as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remindAwarenessAck(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await awControl.remindAck(req.auth, req.params.id as string, req.params.ackId as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

const waiveSchema = z.object({ reason: z.string().min(1).max(4000) });

export async function waiveAwarenessAck(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { reason } = waiveSchema.parse(req.body);
    sendOk(res, await awControl.waiveAck(req.auth, req.params.id as string, req.params.ackId as string, reason, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

const evalResultSchema = z.object({
  method: z.string().max(80).optional(),
  result: z.string().min(1).max(80),
  score: z.string().max(80).optional(),
  evaluator: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
});

export async function recordAwarenessEvaluation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = evalResultSchema.parse(req.body);
    sendOk(res, await awControl.recordEvaluation(req.auth, req.params.id as string, req.params.evalId as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

const followupSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(4000).optional(),
  owner: z.string().max(200).optional(),
  due: z.string().max(40).optional(),
  priority: z.string().max(40).optional(),
});

export async function createAwarenessFollowup(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = followupSchema.parse(req.body);
    sendOk(res, await awControl.createEvalFollowup(req.auth, req.params.id as string, req.params.evalId as string, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function awarenessEvalToTraining(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await awControl.evalToTrainingPlan(req.auth, req.params.id as string, req.params.evalId as string, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

const routeSchema = z.object({
  reviewer: z.string().min(1).max(200),
  classification: z.string().min(1).max(80),
  reviewNotes: z.string().max(4000).optional(),
  routingNotes: z.string().max(4000).optional(),
  relatedExisting: z.string().max(200).optional(),
  closureReason: z.string().max(4000).optional(),
});

export async function routeConcern(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = routeSchema.parse(req.body);
    sendOk(res, await service.routeConcern(req.auth, req.params.id as string, input, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

// --- Training Plan lifecycle (OD `tpComplete` / `tpReassess` / `tpSet`) -----

const trainingCompleteSchema = z.object({
  completionDate: z.string().max(40).optional(),
  completionResult: z.string().max(80).optional(),
  completedBy: z.union([z.array(z.string().max(200)), z.string().max(2000)]).optional(),
  evidence: z.string().max(500).optional(),
  notes: z.string().max(4000).optional(),
});

export async function completeTraining(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = trainingCompleteSchema.parse(req.body);
    sendOk(res, await trainingLifecycle.completeTraining(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

const trainingReassessSchema = z.object({
  result: z.string().min(1).max(80),
  notes: z.string().max(4000).optional(),
});

export async function reassessTraining(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = trainingReassessSchema.parse(req.body);
    sendOk(res, await trainingLifecycle.reassessTraining(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

const trainingSetStatusSchema = z.object({ status: z.enum(["Closed", "Cancelled"]) });

export async function setTrainingStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { status } = trainingSetStatusSchema.parse(req.body);
    sendOk(res, await trainingLifecycle.setTrainingStatus(req.auth, req.params.id as string, status, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
