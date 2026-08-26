import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import * as service from "./personnelProfile.service";
import { sendOk } from "../../lib/apiResponse";
import { UnauthorizedError } from "../../lib/errors";

const personalSchema = z.object({
  dateOfBirth: z.string().nullish(),
  gender: z.string().nullish(),
  maritalStatus: z.string().nullish(),
  nationality: z.string().nullish(),
  idNumber: z.string().nullish(),
  religion: z.string().nullish(),
  bloodType: z.string().nullish(),
  address: z.string().nullish(),
  country: z.string().nullish(),
  state: z.string().nullish(),
  city: z.string().nullish(),
  postalCode: z.string().nullish(),
});

const emergencySchema = z.object({
  emergencyContactName: z.string().nullish(),
  emergencyContactPhone: z.string().nullish(),
  emergencyContactRelationship: z.string().nullish(),
});

const employmentStatusSchema = z.enum(["Probation", "Active", "Contract Ended", "Terminated"]);
const contractTypeSchema = z.enum(["Permanent", "Fixed-Term", "Probation", "Internship", "Outsourced"]);

const employmentSchema = z.object({
  personnelType: z.string().nullish(),
  employmentStatus: employmentStatusSchema.nullish(),
  orgUnitId: z.string().uuid().nullish(),
  siteId: z.string().uuid().nullish(),
  managerId: z.string().uuid().nullish(),
  employeeId: z.string().nullish(),
  contractType: contractTypeSchema.nullish(),
  contractStartDate: z.string().nullish(),
  contractEndDate: z.string().nullish(),
  probationEndDate: z.string().nullish(),
  contractDocumentRef: z.string().nullish(),
  contractSigned: z.boolean().optional(),
});

const renewSchema = z.object({ contractEndDate: z.string().min(1) });
const convertSchema = z.object({ contractType: contractTypeSchema });

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const profile = await service.getPersonnelProfile(req.auth, req.params.id as string);
    sendOk(res, profile);
  } catch (e) {
    next(e);
  }
}

export async function updatePersonal(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = personalSchema.parse(req.body);
    const profile = await service.updatePersonal(req.auth, req.params.id as string, input, req.ip ?? null);
    sendOk(res, profile);
  } catch (e) {
    next(e);
  }
}

export async function updateEmergency(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = emergencySchema.parse(req.body);
    const profile = await service.updateEmergencyContact(req.auth, req.params.id as string, input, req.ip ?? null);
    sendOk(res, profile);
  } catch (e) {
    next(e);
  }
}

export async function updateEmployment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const input = employmentSchema.parse(req.body);
    const profile = await service.updateEmployment(req.auth, req.params.id as string, input, req.ip ?? null);
    sendOk(res, profile);
  } catch (e) {
    next(e);
  }
}

export async function renew(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { contractEndDate } = renewSchema.parse(req.body);
    const profile = await service.renewContract(req.auth, req.params.id as string, contractEndDate, req.ip ?? null);
    sendOk(res, profile);
  } catch (e) {
    next(e);
  }
}

export async function convert(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const { contractType } = convertSchema.parse(req.body);
    const profile = await service.convertContract(req.auth, req.params.id as string, contractType, req.ip ?? null);
    sendOk(res, profile);
  } catch (e) {
    next(e);
  }
}

export async function confirmProbation(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.auth) throw new UnauthorizedError();
    const profile = await service.confirmProbation(req.auth, req.params.id as string, req.ip ?? null);
    sendOk(res, profile);
  } catch (e) {
    next(e);
  }
}
