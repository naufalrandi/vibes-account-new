import { Router } from "express";
import * as c from "./personnelContractComp.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// Mounted in app.ts at "/v1/users/:userId" (same prefix as
// personnelRecords.routes.ts's resume/leave/disciplinary/performance
// sub-paths — no collision, different leaf segments).
export const personnelContractRoutes = Router({ mergeParams: true });

const read = requireAction(ACTIONS.PERSONNEL_CONTRACTDOC_READ);
const manage = requireAction(ACTIONS.PERSONNEL_CONTRACTDOC_MANAGE);
personnelContractRoutes.get("/contract-documents", read, c.listContractDocs);
personnelContractRoutes.post("/contract-documents", manage, c.createContractDoc);
personnelContractRoutes.put("/contract-documents/:docId", manage, c.updateContractDoc);
personnelContractRoutes.post("/contract-documents/:docId/sign", manage, c.signContractDoc);
personnelContractRoutes.post("/contract-documents/:docId/issue", manage, c.issueContractDoc);

const activityRead = requireAction(ACTIONS.PERSONNEL_ACTIVITY_READ);
const activityManage = requireAction(ACTIONS.PERSONNEL_ACTIVITY_MANAGE);
personnelContractRoutes.get("/activity", activityRead, c.listActivity);
personnelContractRoutes.post("/activity", activityManage, c.addActivity);

const onboardingRead = requireAction(ACTIONS.PERSONNEL_ONBOARDING_READ);
const onboardingManage = requireAction(ACTIONS.PERSONNEL_ONBOARDING_MANAGE);
personnelContractRoutes.get("/onboarding", onboardingRead, c.listOnboarding);
personnelContractRoutes.post("/onboarding", onboardingManage, c.addOnboardingItem);
personnelContractRoutes.put("/onboarding/:itemId", onboardingManage, c.setOnboardingDone);
personnelContractRoutes.post("/onboarding/complete", onboardingManage, c.completeOnboarding);
personnelContractRoutes.post("/onboarding/reopen", onboardingManage, c.reopenOnboarding);

const compRead = requireAction(ACTIONS.PERSONNEL_COMPENSATION_READ);
const compManage = requireAction(ACTIONS.PERSONNEL_COMPENSATION_MANAGE);
personnelContractRoutes.get("/compensation", compRead, c.getCompensation);
personnelContractRoutes.put("/compensation", compManage, c.updateCompensation);
personnelContractRoutes.get("/compensation/minwage-check", compRead, c.minwageCheck);
