import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { Menu } from "../../db/models";
import { buildMenuForUser } from "../iam/access.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

/** The current user's navigable menu tree + flat access map. Any authenticated user. */
export async function myMenu(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await buildMenuForUser(req.auth.userId));
  } catch (e) {
    next(e);
  }
}

/** Admin: full menu catalog (flat, all menus). Gated by menu.read. */
export async function listMenus(_req: Request, res: Response, next: NextFunction) {
  try {
    sendOk(res, await Menu.findAll({ order: [["sorting", "ASC"]] }));
  } catch (e) {
    next(e);
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().uuid().nullish(),
  heading: z.string().nullish(),
  route: z.string().nullish(),
  routeSeo: z.string().nullish(),
  icon: z.string().nullish(),
  sorting: z.number().int().optional(),
});

/** Admin: create a menu. Gated by menu.manage. */
export async function createMenu(req: Request, res: Response, next: NextFunction) {
  try {
    const input = createSchema.parse(req.body);
    const menu = await Menu.create({
      name: input.name,
      parentId: input.parentId ?? null,
      heading: input.heading ?? null,
      route: input.route ?? null,
      routeSeo: input.routeSeo ?? null,
      icon: input.icon ?? null,
      sorting: input.sorting ?? 0,
      status: true,
    });
    sendOk(res, menu, 201);
  } catch (e) {
    next(e);
  }
}
