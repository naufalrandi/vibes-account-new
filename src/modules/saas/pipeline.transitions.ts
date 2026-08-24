import type { SaasPipelineStage } from "../../db/models/saas.models";
import { ConflictError } from "../../lib/errors";

/**
 * The six pipeline write actions this module exposes — mirrors OD's
 * pipeAccept / pipeDecline / pipeRegisterSave / pipeUploadProof /
 * pipeVerifyPayment / saasProvisionPipeline (app.html:10616-10821).
 */
export type SaasPipelineAction =
  | "accept"
  | "decline"
  | "saveRegistration"
  | "uploadProof"
  | "verifyPayment"
  | "provision";

/**
 * Stage -> legal actions. Derived 1:1 from OD's `pipeRowActions`
 * (app.html:10693-10699), which is the single source of truth for which
 * button appears at which stage and is therefore the authority for which
 * transition is legal:
 *
 *   Quote Sent          -> Accept | Decline
 *   Accepted            -> Registration (save)      [pipeRowActions still
 *   Registration        -> Registration (save)         checks 'Accepted',
 *                                                       even though pipeAccept
 *                                                       itself jumps straight
 *                                                       to 'Registration' and
 *                                                       never actually
 *                                                       persists 'Accepted' —
 *                                                       kept here for fidelity
 *                                                       to pipeRowActions.]
 *   Awaiting Transfer   -> Upload Proof
 *   Under Verification  -> Verify Payment
 *   Provisioning Failed -> Retry (= provision again)
 *   Completed           -> (view / open tenant only — no pipeline action)
 *   Declined            -> (terminal — no action)
 *
 * 'Verified' is declared in SAAS_PIPE_STAGES but never actually set as a
 * persisted stage by any OD function: pipeVerifyPayment's onOk sets
 * `payment.state='Verified'` and then calls `saasProvisionPipeline` in the
 * very same synchronous click, which jumps the pipe stage straight from
 * 'Under Verification' to 'Completed' without ever writing `stage='Verified'`
 * in between. This backend instead exposes "verify payment" and "provision"
 * as two separate HTTP requests (per the task's action list), so it puts
 * 'Verified' to real use as the resting stage between them — a deliberate,
 * documented adaptation of an OD stage that exists in the model but was
 * previously unreachable in the UI's synchronous flow.
 */
export const SAAS_PIPE_TRANSITIONS: Partial<Record<SaasPipelineStage, SaasPipelineAction[]>> = {
  "Quote Sent": ["accept", "decline"],
  Accepted: ["saveRegistration"],
  Registration: ["saveRegistration"],
  "Awaiting Transfer": ["uploadProof"],
  "Under Verification": ["verifyPayment"],
  Verified: ["provision"],
  "Provisioning Failed": ["provision"],
};

/** Actions legal for a pipeline entry currently at `stage`. */
export function allowedPipelineActions(stage: SaasPipelineStage): SaasPipelineAction[] {
  return SAAS_PIPE_TRANSITIONS[stage] ?? [];
}

/**
 * Enforce the transition table: throws 409 ILLEGAL_TRANSITION when `action`
 * is not legal at `stage`, rather than silently applying it.
 */
export function assertPipelineTransition(stage: SaasPipelineStage, action: SaasPipelineAction): void {
  if (!allowedPipelineActions(stage).includes(action)) {
    throw new ConflictError(`Cannot "${action}" a pipeline entry at stage "${stage}"`, "SAAS_PIPELINE_ILLEGAL_TRANSITION");
  }
}
