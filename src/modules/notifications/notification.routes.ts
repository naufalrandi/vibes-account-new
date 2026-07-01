import { Router } from "express";
import * as c from "./notification.controller";

// Notifications are personal — any authenticated user reads/clears their own bell.
export const notificationRoutes = Router();
notificationRoutes.get("/", c.list);
notificationRoutes.post("/read", c.markRead);
