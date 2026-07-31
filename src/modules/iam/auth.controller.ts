import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as authService from "./auth.service";
import { sendOk } from "../../lib/apiResponse";

const loginSchema = z.object({ identifier: z.string().min(1), password: z.string().min(1) });
const tokenSchema = z.object({ token: z.string().min(1), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const emailSchema = z.object({ email: z.string().email() });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    await authService.changePassword(req.auth!.userId, currentPassword, newPassword, req.ip ?? null);
    sendOk(res, { changed: true });
  } catch (e) {
    next(e);
  }
}

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
    sendOk(res, await authService.refresh(refreshToken, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const { refreshToken } = refreshSchema.parse(req.body);
    await authService.logout(refreshToken, req.ip ?? null);
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

export async function demoLinkLogin(req: Request, res: Response, next: NextFunction) {
  try {
    const { demoId } = z.object({ demoId: z.string().max(64) }).parse(req.body);
    sendOk(res, await authService.demoLinkLogin(demoId, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}
