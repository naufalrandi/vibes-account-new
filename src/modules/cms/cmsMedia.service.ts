import fs from "node:fs";
import path from "node:path";
import { Op, type WhereOptions } from "sequelize";
import { CmsMedia } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { visibleTenantOrgIds } from "../sites/site.service";
import { writeAudit } from "../audit/audit.service";
import { ForbiddenError, NotFoundError } from "../../lib/errors";

/** Root directory real uploaded files live under; served via express.static at /uploads. */
export const UPLOAD_ROOT = path.join(process.cwd(), "uploads", "cms");

async function orgWhere(auth: AuthContext): Promise<WhereOptions> {
  const ids = await visibleTenantOrgIds(auth);
  return ids === null ? {} : { orgId: { [Op.in]: ids } };
}

async function assertCanSeeOrg(auth: AuthContext, orgId: string): Promise<void> {
  const ids = await visibleTenantOrgIds(auth);
  if (ids !== null && !ids.includes(orgId)) throw new ForbiddenError();
}

export async function listMedia(auth: AuthContext): Promise<CmsMedia[]> {
  const where = await orgWhere(auth);
  return CmsMedia.findAll({ where, order: [["createdAt", "DESC"]] });
}

async function requireMedia(auth: AuthContext, id: string): Promise<CmsMedia> {
  const m = await CmsMedia.findByPk(id);
  if (!m) throw new NotFoundError("Media does not exist", "MEDIA_NOT_FOUND");
  await assertCanSeeOrg(auth, m.orgId);
  return m;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  path: string; // absolute disk path multer saved to
  filename: string;
}

/** Persists a DB row for an already-saved multer file. Size/type come from the server-verified `file`, never the client body. */
export async function recordUpload(auth: AuthContext, file: UploadedFile, alt: string | null, ip: string | null): Promise<CmsMedia> {
  const relUrl = `/uploads/cms/${auth.orgId}/${file.filename}`;
  const m = await CmsMedia.create({
    orgId: auth.orgId,
    name: file.originalname,
    type: file.mimetype,
    alt,
    size: file.size,
    url: relUrl,
    createdBy: auth.userId,
  });
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.media.uploaded", entityType: "CmsMedia", entityId: m.id, sourceIp: ip, result: "Success" });
  return m;
}

export async function deleteMedia(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const m = await requireMedia(auth, id);
  const abs = path.join(UPLOAD_ROOT, m.orgId, path.basename(m.url));
  await m.destroy();
  fs.promises.unlink(abs).catch(() => undefined); // ponytail: best-effort disk cleanup, orphaned file if this fails
  await writeAudit({ actorUserId: auth.userId, organizationId: auth.orgId, action: "cms.media.deleted", entityType: "CmsMedia", entityId: id, sourceIp: ip, result: "Success" });
}
