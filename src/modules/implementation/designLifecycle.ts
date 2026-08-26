/**
 * Design & Development stage-advance rule (OD `dndAdvance`/`dndStageBar`,
 * app.html:22103-22177), server-side. The 6-stage linear progression a
 * design record steps through one stage at a time; "On Hold" and "Retired"
 * sit outside it and stay freely reachable from anywhere, matching OD's
 * unrestricted direct-edit status field.
 */
import { BadRequestError } from "../../lib/errors";

export const DND_STAGES = [
  "Concept", "In Design", "Design Review", "Verification", "Validation", "Released",
] as const;

/**
 * Enforced on every status write, not just the dedicated Advance action — a
 * stage machine only means something if out-of-order jumps are refused
 * everywhere a status can be set, not only through the one button that
 * happens to compute the next stage correctly.
 */
export function assertDesignTransition(from: string, to: string): void {
  if (from === to) return;
  const fromIdx = DND_STAGES.indexOf(from as (typeof DND_STAGES)[number]);
  const toIdx = DND_STAGES.indexOf(to as (typeof DND_STAGES)[number]);
  if (fromIdx < 0 || toIdx < 0) return;
  if (toIdx !== fromIdx + 1) {
    throw new BadRequestError(
      `Design stage must advance one step at a time — cannot move from "${from}" to "${to}"`,
      "INVALID_TRANSITION",
    );
  }
}
