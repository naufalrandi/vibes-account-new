import type { Response } from "express";

export interface Meta {
  page: number;
  limit: number;
  total: number;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string } | null;
  meta: Meta | null;
}

export function ok<T>(data: T, meta: Meta | null = null): ApiEnvelope<T> {
  return { success: true, data, error: null, meta };
}

export function fail(code: string, message: string): ApiEnvelope<never> {
  return { success: false, data: null, error: { code, message }, meta: null };
}

export function sendOk<T>(res: Response, data: T, status = 200, meta: Meta | null = null): void {
  res.status(status).json(ok(data, meta));
}
