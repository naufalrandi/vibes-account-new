import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as authService from "./auth.service";
import { sendOk } from "../../lib/apiResponse";

const loginSchema = z.object({ identifier: z.string().min(1), password: z.string().min(1) });
const tokenSchema = z.object({ token: z.string().min(1), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const emailSchema = z.object({ email: z.string().email() });

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { identifier, password } = loginSchema.parse(req.body);
    const result = await authService.login(identifier, password, req.ip ?? null);
    sendOk(res, result);
  } catch (e) {
    next(e);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    sendOk(res, await authService.refresh(refreshToken));
  } catch (e) {
    next(e);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    await authService.logout(refreshToken);
    sendOk(res, { loggedOut: true });
  } catch (e) {
    next(e);
  }
}

export async function activate(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = tokenSchema.parse(req.body);
    await authService.activate(token, password);
    sendOk(res, { activated: true });
  } catch (e) {
    next(e);
  }
}

export async function forgotPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { email } = emailSchema.parse(req.body);
    await authService.requestPasswordReset(email);
    sendOk(res, { requested: true });
  } catch (e) {
    next(e);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { token, password } = tokenSchema.parse(req.body);
    await authService.resetPassword(token, password);
    sendOk(res, { reset: true });
  } catch (e) {
    next(e);
  }
}
