import type { Request, Response } from "express";
import * as service from "./reference.service";
import { sendOk } from "../../lib/apiResponse";

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

// Reference data is immutable — cache aggressively at the edge/client (R7).
function cacheable(res: Response) {
  res.set("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
}

export function isic(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.listIsic(str(req.query.parent), str(req.query.search)));
}
export function isicNotes(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.isicNotes(req.params.code as string));
}
export function nace(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.listNace(str(req.query.parent), str(req.query.search)));
}
export function naceNotes(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.naceNotes(req.params.code as string));
}
export function kbli(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.listKbli(str(req.query.parent), str(req.query.search)));
}
export function kbliNotes(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.kbliNotes(req.params.code as string));
}
export function iscedf(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.listIscedf(str(req.query.search)));
}
export function examBank(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.examBank(str(req.query.skill), str(req.query.level)));
}
export function roleSuggestions(req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.roleSuggestions(str(req.query.q)));
}
export function skillTopics(_req: Request, res: Response) {
  cacheable(res);
  sendOk(res, service.skillTopics());
}
