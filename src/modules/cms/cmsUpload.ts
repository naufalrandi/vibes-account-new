import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";
import type { Request, Response } from "express";
import { UPLOAD_ROOT } from "./cmsMedia.service";
import { BadRequestError } from "../../lib/errors";

/**
 * Upload allowlist — extension AND reported mimetype must both match. Never
 * SVG/HTML/JS: those execute when served from our origin.
 */
const ALLOWED: Record<string, readonly string[]> = {
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".gif": ["image/gif"],
  ".webp": ["image/webp"],
  ".pdf": ["application/pdf"],
};
const INLINE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

export function isAllowedUpload(originalname: string, mimetype: string): boolean {
  return ALLOWED[path.extname(originalname).toLowerCase()]?.includes(mimetype.toLowerCase()) ?? false;
}

/** Create the upload root once at boot (per-org dirs are made once per process, below). */
export function ensureUploadRoot(): void {
  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
}

/**
 * Headers for files served from /uploads/cms: never sniffed, never scripted,
 * and anything that isn't an image downloads instead of rendering inline.
 */
export function uploadHeaders(res: Response, filePath: string): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  if (!INLINE_EXTS.has(path.extname(filePath).toLowerCase())) {
    res.setHeader("Content-Disposition", "attachment");
  }
}

const madeDirs = new Set<string>();

const storage = multer.diskStorage({
  destination: (req: Request, _file, cb) => {
    const orgId = req.auth?.orgId;
    if (!orgId) return cb(new Error("Missing auth context"), "");
    const dir = path.join(UPLOAD_ROOT, orgId);
    if (madeDirs.has(dir)) return cb(null, dir);
    fs.promises.mkdir(dir, { recursive: true }).then(
      () => { madeDirs.add(dir); cb(null, dir); },
      (e: Error) => cb(e, ""),
    );
  },
  filename: (_req, file, cb) => {
    // Extension is already allowlisted by fileFilter; normalise its case.
    cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

export const cmsUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedUpload(file.originalname, file.mimetype)) return cb(null, true);
    cb(new BadRequestError("Only JPG, PNG, GIF, WEBP or PDF files may be uploaded", "UNSUPPORTED_FILE_TYPE"));
  },
});
