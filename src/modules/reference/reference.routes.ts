import { Router } from "express";
import * as c from "./reference.controller";

// Immutable reference lookups — any authenticated user; heavily cacheable.
export const referenceRoutes = Router();
referenceRoutes.get("/isic", c.isic);
referenceRoutes.get("/isic/:code/notes", c.isicNotes);
referenceRoutes.get("/nace", c.nace);
referenceRoutes.get("/nace/:code/notes", c.naceNotes);
referenceRoutes.get("/kbli", c.kbli);
referenceRoutes.get("/kbli/:code/notes", c.kbliNotes);
referenceRoutes.get("/iscedf", c.iscedf);
referenceRoutes.get("/exam-bank", c.examBank);
referenceRoutes.get("/role-suggestions", c.roleSuggestions);
