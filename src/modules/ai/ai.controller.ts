import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as aiService from "./ai.service";
import { isAiAvailable } from "../../lib/ai";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const provider = z.enum(["anthropic", "openai"]);
// "" / null = the provider's default base URL.
const baseUrl = z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(2000)]).nullish();
// "" / null / omitted = keep the stored key.
const apiKey = z.string().max(1000).nullish();

const saveSchema = z.object({
  provider,
  baseUrl,
  apiKey,
  model: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  maxOutputTokens: z.number().int().min(256).max(128_000).optional(),
  timeoutMs: z.number().int().min(5_000).max(600_000).optional(),
});

const modelsSchema = z.object({ provider: provider.optional(), baseUrl, apiKey });
const testSchema = modelsSchema.extend({ model: z.string().trim().max(200).nullish() });

export async function getConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await aiService.getConnection(req.auth));
  } catch (e) {
    next(e);
  }
}

export async function saveConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await aiService.saveConnection(req.auth, saveSchema.parse(req.body), req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function deleteConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await aiService.deleteConnection(req.auth, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function testConnection(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await aiService.testConnection(req.auth, testSchema.parse(req.body ?? {}), req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function listModels(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await aiService.listModels(req.auth, modelsSchema.parse(req.body ?? {})));
  } catch (e) {
    next(e);
  }
}

/** Any signed-in user: lets AI buttons show/hide without exposing the settings. */
export async function status(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, { available: await isAiAvailable() });
  } catch (e) {
    next(e);
  }
}
