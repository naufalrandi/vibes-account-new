import express from "express";

export function createApp() {
  const app = express();
  app.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" }, error: null, meta: null }));
  return app;
}
