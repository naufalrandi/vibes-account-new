import { describe, it, expect } from "vitest";
import type { Response } from "express";
import { isAllowedUpload, uploadHeaders } from "./cmsUpload";

describe("isAllowedUpload", () => {
  it("accepts allowlisted images and PDFs when extension and mimetype agree", () => {
    expect(isAllowedUpload("photo.JPG", "image/jpeg")).toBe(true);
    expect(isAllowedUpload("logo.png", "image/png")).toBe(true);
    expect(isAllowedUpload("doc.pdf", "application/pdf")).toBe(true);
  });

  it("rejects SVG/HTML/JS and extension/mimetype mismatches", () => {
    expect(isAllowedUpload("x.svg", "image/svg+xml")).toBe(false);
    expect(isAllowedUpload("x.html", "text/html")).toBe(false);
    expect(isAllowedUpload("x.js", "application/javascript")).toBe(false);
    expect(isAllowedUpload("x.png", "text/html")).toBe(false);
    expect(isAllowedUpload("x.html", "image/png")).toBe(false);
    expect(isAllowedUpload("noext", "image/png")).toBe(false);
  });
});

describe("uploadHeaders", () => {
  const headersFor = (file: string) => {
    const h: Record<string, string> = {};
    uploadHeaders({ setHeader: (k: string, v: string) => { h[k] = v; } } as unknown as Response, file);
    return h;
  };

  it("serves images inline but never sniffed or scripted", () => {
    const h = headersFor("/u/a.png");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toBe("default-src 'none'");
    expect(h["Content-Disposition"]).toBeUndefined();
  });

  it("forces a download for anything that is not an image", () => {
    expect(headersFor("/u/a.pdf")["Content-Disposition"]).toBe("attachment");
    expect(headersFor("/u/legacy.svg")["Content-Disposition"]).toBe("attachment");
  });
});
