import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./document.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const kindSchema = z.enum(["internal", "external"]);
// ponytail: single Draft/Published/Archived lifecycle only — no multi-stage
// review/signoff/ack workflow. See the `// ponytail:` note on Document.status
// in src/db/models/document.model.ts for the upgrade path.
const statusSchema = z.enum(["Draft", "Published", "Archived"]);
const folderStatusSchema = z.enum(["Active", "Archived"]);
const blockSchema = z.object({ id: z.string(), type: z.string(), html: z.string() });

const documentInputSchema = z.object({
  kind: kindSchema.optional(),
  title: z.string().max(300).optional(),
  docType: z.string().max(100).nullish(),
  status: statusSchema.optional(),
  version: z.string().max(20).optional(),
  content: z.array(blockSchema).max(1_000).nullish(),
  folderId: z.string().uuid().nullish(),
  issuer: z.string().max(200).nullish(),
  link: z.string().max(2_000).nullish(),
  effectiveDate: z.string().max(10).nullish(),
  nextReview: z.string().max(10).nullish(),
  owner: z.string().max(200).nullish(),
  notes: z.string().max(5_000).nullish(),
});

const folderInputSchema = z.object({
  name: z.string().max(200).optional(),
  description: z.string().max(2_000).nullish(),
  status: folderStatusSchema.optional(),
});

// --- Folders ----------------------------------------------------------------

export async function listFolders(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.listFolders(req.auth));
  } catch (e) {
    next(e);
  }
}

export async function createFolder(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = folderInputSchema.parse(req.body);
    sendOk(res, await service.createFolder(req.auth, { ...input, name: input.name ?? "" }, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function updateFolder(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = folderInputSchema.parse(req.body);
    sendOk(res, await service.updateFolder(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function removeFolder(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteFolder(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}

// --- Documents ----------------------------------------------------------------

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const kind = typeof req.query.kind === "string" ? (req.query.kind as "internal" | "external") : undefined;
    const folderId = typeof req.query.folderId === "string" ? req.query.folderId : undefined;
    const status = typeof req.query.status === "string" ? (req.query.status as "Draft" | "Published" | "Archived") : undefined;
    const search = typeof req.query.search === "string" ? req.query.search : undefined;
    const rows = await service.listDocuments(req.auth, { kind, folderId, status, search });
    sendOk(res, rows, 200, { page: 1, limit: rows.length, total: rows.length });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.getDocument(req.auth, req.params.id as string));
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = documentInputSchema.parse(req.body);
    // The service enforces title/kind presence (throws BadRequest if missing).
    sendOk(res, await service.createDocument(req.auth, { ...input, title: input.title ?? "", kind: input.kind ?? ("internal" as const) }, req.ip ?? null), 201);
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = documentInputSchema.parse(req.body);
    sendOk(res, await service.updateDocument(req.auth, req.params.id as string, input, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function publish(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.publish(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    sendOk(res, await service.archive(req.auth, req.params.id as string, req.ip ?? null));
  } catch (e) {
    next(e);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    await service.deleteDocument(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, { id: req.params.id });
  } catch (e) {
    next(e);
  }
}
