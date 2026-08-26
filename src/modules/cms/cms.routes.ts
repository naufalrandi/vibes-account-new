import { Router } from "express";
import * as c from "./cms.controller";
import { cmsUpload } from "./cmsUpload";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const cmsRoutes = Router();

// Pages
cmsRoutes.get("/pages", requireAction(ACTIONS.CMS_READ), c.listPages);
cmsRoutes.post("/pages", requireAction(ACTIONS.CMS_MANAGE), c.createPage);
cmsRoutes.get("/pages/:id", requireAction(ACTIONS.CMS_READ), c.getPage);
cmsRoutes.patch("/pages/:id", requireAction(ACTIONS.CMS_MANAGE), c.updatePage);
cmsRoutes.post("/pages/:id/publish", requireAction(ACTIONS.CMS_MANAGE), c.publishPage);
cmsRoutes.post("/pages/:id/archive", requireAction(ACTIONS.CMS_MANAGE), c.archivePage);

// Posts
cmsRoutes.get("/posts", requireAction(ACTIONS.CMS_READ), c.listPosts);
cmsRoutes.post("/posts", requireAction(ACTIONS.CMS_MANAGE), c.createPost);
cmsRoutes.get("/posts/:id", requireAction(ACTIONS.CMS_READ), c.getPost);
cmsRoutes.patch("/posts/:id", requireAction(ACTIONS.CMS_MANAGE), c.updatePost);
cmsRoutes.post("/posts/:id/publish", requireAction(ACTIONS.CMS_MANAGE), c.publishPost);
cmsRoutes.post("/posts/:id/archive", requireAction(ACTIONS.CMS_MANAGE), c.archivePost);

// Media — `/media/reorder`-style literals aren't needed here, but `/media/:id` still comes after `/media`.
cmsRoutes.get("/media", requireAction(ACTIONS.CMS_READ), c.listMedia);
cmsRoutes.post("/media", requireAction(ACTIONS.CMS_MANAGE), cmsUpload.single("file"), c.uploadMedia);
cmsRoutes.delete("/media/:id", requireAction(ACTIONS.CMS_MANAGE), c.removeMedia);

// Menu — `/menu/reorder` literal before `/menu/:id`.
cmsRoutes.get("/menu", requireAction(ACTIONS.CMS_READ), c.listMenu);
cmsRoutes.post("/menu", requireAction(ACTIONS.CMS_MANAGE), c.createMenuItem);
cmsRoutes.post("/menu/reorder", requireAction(ACTIONS.CMS_MANAGE), c.reorderMenu);
cmsRoutes.patch("/menu/:id", requireAction(ACTIONS.CMS_MANAGE), c.updateMenuItem);
cmsRoutes.delete("/menu/:id", requireAction(ACTIONS.CMS_MANAGE), c.removeMenuItem);

// Settings
cmsRoutes.get("/settings", requireAction(ACTIONS.CMS_READ), c.getSettings);
cmsRoutes.put("/settings", requireAction(ACTIONS.CMS_MANAGE), c.putSettings);
