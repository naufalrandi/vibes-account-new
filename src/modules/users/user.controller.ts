import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as userService from "./user.service";
import { sendOk } from "../../lib/apiResponse";
import { paginate } from "../../lib/pagination";
import { UnauthorizedError } from "../../lib/errors";

const permissionModeSchema = z.enum(["Full Access", "Custom Access"]);

const createSchema = z.object({
  orgId: z.string().uuid(),
  fullName: z.string().min(1),
  username: z.string().min(1),
  email: z.string().email(),
  // `roleGroup` is the AXIA alias for the canonical role name; either is accepted.
  role: z.string().optional(),
  roleGroup: z.string().optional(),
  password: z.string().min(1).optional(),
  permissionMode: permissionModeSchema.nullish(),
  permissions: z.array(z.string()).nullish(),
  position: z.string().nullish(),
  phone: z.string().nullish(),
  photo: z.string().nullish(),
  workUnit: z.string().nullish(),
  department: z.string().nullish(),
});

const updateSchema = z.object({
  fullName: z.string().min(1).optional(),
  username: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(1).optional(),
  role: z.string().optional(),
  roleGroup: z.string().optional(),
  permissionMode: permissionModeSchema.nullish(),
  permissions: z.array(z.string()).nullish(),
  status: z.enum(["PendingActivation", "Active", "Suspended", "Inactive"]).optional(),
  position: z.string().nullish(),
  phone: z.string().nullish(),
  photo: z.string().nullish(),
  workUnit: z.string().nullish(),
  // OD tenant-team member fields (migration 0047).
  siteId: z.string().uuid().nullish(),
  personnelType: z.string().nullish(),
  processIds: z.array(z.string()).nullish(),
});

const statusSchema = z.object({ status: z.enum(["Active", "Suspended", "Inactive"]) });

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { roleGroup, ...rest } = createSchema.parse(req.body);
    const user = await userService.createUser(req.auth, { ...rest, role: roleGroup ?? rest.role }, req.ip ?? null);
    sendOk(res, user, 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { roleGroup, ...rest } = updateSchema.parse(req.body);
    const user = await userService.updateUser(
      req.auth,
      req.params.id as string,
      { ...rest, role: roleGroup ?? rest.role },
      req.ip ?? null,
    );
    sendOk(res, user);
  } catch (e) {
    next(e);
  }
}

export async function softDelete(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const user = await userService.softDeleteUser(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, user);
  } catch (e) {
    next(e);
  }
}

export async function resendActivation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await userService.resendActivation(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { resent: true });
  } catch (e) {
    next(e);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const users = await userService.listUsers(req.auth, {
      orgType: req.query.orgType as string | undefined,
      orgId: req.query.orgId as string | undefined,
      role: req.query.role as string | undefined,
      status: req.query.status as string | undefined,
      email: req.query.email as string | undefined,
      username: req.query.username as string | undefined,
      search: req.query.search as string | undefined,
    });
    const { items, meta } = paginate(users, req.query);
    sendOk(res, items, 200, meta);
  } catch (e) {
    next(e);
  }
}

export async function setStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { status } = statusSchema.parse(req.body);
    const user = await userService.setUserStatus(req.auth, req.params.id as string, status, req.ip ?? null);
    sendOk(res, user);
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await userService.removeUser(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { removed: true });
  } catch (e) {
    next(e);
  }
}

export async function assignRole(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await userService.assignRole(req.auth, req.params.id as string, req.body.roleId, req.ip ?? null);
    sendOk(res, { assigned: true }, 201);
  } catch (e) {
    next(e);
  }
}

export async function removeRole(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await userService.removeRole(req.auth, req.params.id as string, req.params.roleId as string, req.ip ?? null);
    sendOk(res, { removed: true });
  } catch (e) {
    next(e);
  }
}
