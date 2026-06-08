import { Router } from "express";
import * as c from "./notification.controller";

// The in-app bell is shown to every authenticated persona, so these routes only
// require authentication (applied at mount) — visibility is scoped in the service.
export const notificationRoutes = Router();
notificationRoutes.get("/", c.list);
notificationRoutes.post("/read", c.markRead);
