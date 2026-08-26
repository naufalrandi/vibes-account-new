import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import type { Request } from "express";
import { UPLOAD_ROOT } from "./cmsMedia.service";

const storage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const orgId = req.auth?.orgId;
    if (!orgId) return cb(new Error("Missing auth context"), "");
    const dir = path.join(UPLOAD_ROOT, orgId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(0, 20);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

// ponytail: 20MB cap and no mime allowlist beyond what the browser reports —
// good enough for an internal CMS uploader; add stricter content sniffing if
// this ever accepts untrusted public uploads.
export const cmsUpload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });
