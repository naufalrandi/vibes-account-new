import { Router } from "express";
import * as c from "./personnelRecords.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// Mounted in app.ts at "/v1/users/:userId" — every path below is nested under
// a personnel record's owning user (see personnelRecords.service.ts's
// requireManagedUser for the scope check on that user).
export const personnelRecordsRoutes = Router({ mergeParams: true });

personnelRecordsRoutes.get("/resume-records", requireAction(ACTIONS.PERSONNEL_RESUME_READ), c.listResume);
personnelRecordsRoutes.post("/resume-records", requireAction(ACTIONS.PERSONNEL_RESUME_CREATE), c.createResume);
personnelRecordsRoutes.delete("/resume-records/:id", requireAction(ACTIONS.PERSONNEL_RESUME_DELETE), c.deleteResume);

personnelRecordsRoutes.get("/leave-records", requireAction(ACTIONS.PERSONNEL_LEAVE_READ), c.listLeave);
personnelRecordsRoutes.post("/leave-records", requireAction(ACTIONS.PERSONNEL_LEAVE_CREATE), c.createLeave);
personnelRecordsRoutes.delete("/leave-records/:id", requireAction(ACTIONS.PERSONNEL_LEAVE_DELETE), c.deleteLeave);

personnelRecordsRoutes.get("/disciplinary-records", requireAction(ACTIONS.PERSONNEL_DISCIPLINARY_READ), c.listDisciplinary);
personnelRecordsRoutes.post("/disciplinary-records", requireAction(ACTIONS.PERSONNEL_DISCIPLINARY_CREATE), c.createDisciplinary);
personnelRecordsRoutes.delete("/disciplinary-records/:id", requireAction(ACTIONS.PERSONNEL_DISCIPLINARY_DELETE), c.deleteDisciplinary);

personnelRecordsRoutes.get("/performance-records", requireAction(ACTIONS.PERSONNEL_PERFORMANCE_READ), c.listPerformance);
personnelRecordsRoutes.post("/performance-records", requireAction(ACTIONS.PERSONNEL_PERFORMANCE_CREATE), c.createPerformance);
personnelRecordsRoutes.delete("/performance-records/:id", requireAction(ACTIONS.PERSONNEL_PERFORMANCE_DELETE), c.deletePerformance);
