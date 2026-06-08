import { Framework, Requirement, Element, ElementRequirementMap } from "../../db/models";
import type { AuthContext } from "../../lib/scope";
import { ForbiddenError } from "../../lib/errors";

export interface XrefRequirement {
  id: string;
  code: string;
  subject: string;
  description: string;
  frameworkId: string;
  frameworkName: string;
}
export interface XrefElement {
  id: string;
  name: string;
  description: string | null;
}
export interface XrefByElement {
  elementId: string;
  elementName: string;
  elementDescription: string | null;
  requirements: XrefRequirement[];
}
export interface XrefByRequirement {
  requirementId: string;
  code: string;
  subject: string;
  frameworkId: string;
  frameworkName: string;
  elements: XrefElement[];
}
export interface CrossReference {
  byElement: XrefByElement[];
  byRequirement: XrefByRequirement[];
}

function assertServiceOwner(auth: AuthContext): void {
  if (auth.orgType !== "ServiceOwner") {
    throw new ForbiddenError("Only the Service Owner can view the framework cross-reference");
  }
}

function sortReq(a: XrefRequirement, b: XrefRequirement): number {
  if (a.frameworkName !== b.frameworkName) return a.frameworkName.localeCompare(b.frameworkName);
  return a.code.localeCompare(b.code);
}

export async function getCrossReference(auth: AuthContext): Promise<CrossReference> {
  assertServiceOwner(auth);
  // Flat queries + in-memory joins (avoids dropping grandchildren under a
  // belongsToMany through-join).
  const [elements, requirements, maps] = await Promise.all([
    Element.findAll({ order: [["name", "ASC"]] }),
    Requirement.findAll({ include: [{ model: Framework }] }),
    ElementRequirementMap.findAll(),
  ]);

  const xrefById = new Map<string, XrefRequirement>(
    requirements.map((r) => {
      const fw = r.get("Framework") as Framework | undefined;
      return [r.id, { id: r.id, code: r.code, subject: r.subject, description: r.description, frameworkId: r.frameworkId, frameworkName: fw?.name ?? "" }];
    }),
  );
  const elementById = new Map<string, Element>(elements.map((e) => [e.id, e]));

  const reqsByElement = new Map<string, XrefRequirement[]>();
  const elsByRequirement = new Map<string, XrefElement[]>();
  for (const m of maps) {
    const xr = xrefById.get(m.requirementId);
    const el = elementById.get(m.elementId);
    if (xr) {
      const list = reqsByElement.get(m.elementId) ?? [];
      list.push(xr);
      reqsByElement.set(m.elementId, list);
    }
    if (el) {
      const list = elsByRequirement.get(m.requirementId) ?? [];
      list.push({ id: el.id, name: el.name, description: el.description });
      elsByRequirement.set(m.requirementId, list);
    }
  }

  const byElement: XrefByElement[] = elements.map((el) => ({
    elementId: el.id,
    elementName: el.name,
    elementDescription: el.description,
    requirements: (reqsByElement.get(el.id) ?? []).sort(sortReq),
  }));

  const byRequirement: XrefByRequirement[] = requirements
    .map((r) => {
      const base = xrefById.get(r.id)!;
      return {
        requirementId: base.id,
        code: base.code,
        subject: base.subject,
        frameworkId: base.frameworkId,
        frameworkName: base.frameworkName,
        elements: (elsByRequirement.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .sort((a, b) => (a.frameworkName !== b.frameworkName ? a.frameworkName.localeCompare(b.frameworkName) : a.code.localeCompare(b.code)));

  return { byElement, byRequirement };
}
