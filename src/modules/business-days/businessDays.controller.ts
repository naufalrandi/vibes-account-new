import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { nextWorkingDay } from "../../lib/businessDays";
import { sendOk } from "../../lib/apiResponse";
import { resolveHolidays } from "./holidaySeed";

const rollSchema = z.object({
  date: z.string().min(1),
  country: z.string().optional(),
});

/**
 * `POST /v1/business-days/roll` — rolls `date` forward onto the next working
 * day (server-computed, per BE-9's design note: this is the one place cut-off
 * and pay dates are resolved, so every client gets the same answer for the
 * same input). Used today by Enterprise · Payroll Calendar
 * (`EnterprisePayrollPage.tsx`); any future SLA/lead-time field can call the
 * same endpoint rather than re-deriving this in the browser.
 */
export async function roll(req: Request, res: Response, next: NextFunction) {
  try {
    const { date, country } = rollSchema.parse(req.body);
    const holidays = resolveHolidays(country);
    const result = nextWorkingDay(date, holidays);
    sendOk(res, { date: date.slice(0, 10), country: (country || "ID").toUpperCase(), result, rolled: result !== date.slice(0, 10) });
  } catch (e) { next(e); }
}
