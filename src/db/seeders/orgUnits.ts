/**
 * SOF-407 (design: SOF-386, revision 8c8dc4ed) — seeds the demo tenant's
 * Enterprise org structure: 32 static `OrgUnit` rows (transcribed verbatim
 * from OD's `orgUnits.json` dump — id/name/tier/parentId/appt levels) plus
 * the synthetic lead roster OD's `orgPeopleSeedIfNeeded` (modules.js:4459-4462)
 * generates to fill each unit's appointable levels.
 *
 * `OrgUnit.id` is a UUID PK — OD's string ids (`ou-smt`, ...) can't be reused,
 * so units upsert by `(orgId, name)` natural key and an in-memory
 * `name -> uuid` map resolves `parentId` on a second pass. Users upsert by
 * `username` (`orgunit1..N`) for idempotency; `appt` is built directly from
 * the ids just created, so `assertAppt` (orgUnit.service.ts) is trivially
 * satisfied — no OD id/username ever has to resolve against our roster.
 */
import { OrgUnit, User } from "../models";

/** OD `orgUnits.json` dump — tier B-E `levels` are only the tiers actually
 * appointable per `tierAppointLevels` (orgUnit.service.ts): A-D senior+base,
 * E capped at L9/L10 (L11/L12 exist in OD's mockup but aren't API-appointable
 * here, so no unit below is assigned them). */
const ORG_UNIT_DEFS = [
  { id: "ou-smt", name: "Senior Management Team", tier: "A", parent: null, levels: ["L1", "L2"] },
  { id: "ou-ops", name: "Operations", tier: "B", parent: "ou-smt", levels: ["L3", "L4"] },
  { id: "ou-commercial", name: "Commercial", tier: "C", parent: "ou-ops", levels: ["L5", "L6"] },
  { id: "ou-bizdev", name: "Business Development", tier: "C", parent: "ou-ops", levels: ["L5", "L6"] },
  { id: "ou-finance", name: "Finance", tier: "C", parent: "ou-ops", levels: ["L6"] },
  { id: "ou-procurement", name: "Procurement", tier: "C", parent: "ou-ops", levels: ["L6"] },
  { id: "ou-hr", name: "Human Resources", tier: "C", parent: "ou-ops", levels: ["L6"] },
  { id: "ou-corpsec", name: "Corporate Secretary", tier: "C", parent: "ou-ops", levels: ["L6"] },
  { id: "ou-it", name: "Information Technology", tier: "C", parent: "ou-ops", levels: ["L6"] },
  { id: "ou-sales", name: "Sales", tier: "D", parent: "ou-commercial", levels: ["L7", "L8"] },
  { id: "ou-marketing", name: "Marketing", tier: "D", parent: "ou-commercial", levels: ["L7", "L8"] },
  { id: "ou-partnership", name: "Partnership", tier: "D", parent: "ou-bizdev", levels: ["L8"] },
  { id: "ou-innovation", name: "Innovation", tier: "D", parent: "ou-bizdev", levels: ["L8"] },
  { id: "ou-treasury", name: "Treasury", tier: "D", parent: "ou-finance", levels: ["L7", "L8"] },
  { id: "ou-accounting", name: "Accounting", tier: "D", parent: "ou-finance", levels: ["L8"] },
  { id: "ou-tax", name: "Tax", tier: "D", parent: "ou-finance", levels: ["L8"] },
  { id: "ou-purchasing", name: "Purchasing", tier: "D", parent: "ou-procurement", levels: ["L8"] },
  { id: "ou-suppliers", name: "Suppliers", tier: "D", parent: "ou-procurement", levels: ["L8"] },
  { id: "ou-asset", name: "Asset", tier: "D", parent: "ou-procurement", levels: ["L8"] },
  { id: "ou-recruitment", name: "Recruitment", tier: "D", parent: "ou-hr", levels: ["L8"] },
  { id: "ou-personnel", name: "Personnel", tier: "D", parent: "ou-hr", levels: ["L8"] },
  { id: "ou-payroll", name: "Payroll", tier: "D", parent: "ou-hr", levels: ["L8"] },
  { id: "ou-learning", name: "Learning", tier: "D", parent: "ou-hr", levels: ["L8"] },
  { id: "ou-swdev", name: "Software Development", tier: "D", parent: "ou-it", levels: ["L8"] },
  { id: "ou-ictops", name: "ICT Operations", tier: "D", parent: "ou-it", levels: ["L8"] },
  { id: "ou-projmgmt", name: "Project Management", tier: "E", parent: "ou-swdev", levels: ["L9"] },
  { id: "ou-frontend", name: "Front End Development", tier: "E", parent: "ou-swdev", levels: ["L9"] },
  { id: "ou-backend", name: "Back End Development", tier: "E", parent: "ou-swdev", levels: ["L10"] },
  { id: "ou-devsecops", name: "DevSecOps", tier: "E", parent: "ou-swdev", levels: ["L9"] },
  { id: "ou-cloud", name: "Cloud", tier: "E", parent: "ou-ictops", levels: ["L9"] },
  { id: "ou-equipment", name: "Equipment", tier: "E", parent: "ou-ictops", levels: ["L10"] },
  { id: "ou-network", name: "Network", tier: "E", parent: "ou-ictops", levels: ["L9"] },
] as const;

/** Position title per employment level (mirrors `EMP_TIERS`, orgUnit.service.ts). */
const LEVEL_TITLE: Record<string, string> = {
  L1: "Chief Executive", L2: "Executive Officer", L3: "Senior Director", L4: "Director",
  L5: "Senior Division Manager", L6: "Division Manager", L7: "Senior Department Manager",
  L8: "Department Manager", L9: "Unit Manager", L10: "Unit Supervisor",
};

/** OD's 48-name cycling pool (`orgPeopleSeedIfNeeded`) — synthetic lead identities. */
const NAME_POOL = [
  "Ahmad Wijaya", "Siti Nurhaliza", "Budi Santoso", "Dewi Lestari", "Eko Prasetyo",
  "Fitri Handayani", "Gunawan Setiadi", "Hesti Purnama", "Indra Kusuma", "Joko Widodo",
  "Kartika Sari", "Lukman Hakim", "Maya Anggraini", "Nugroho Aditya", "Oki Rahman",
  "Putri Wulandari", "Qori Ramadhan", "Rina Marlina", "Sandi Firmansyah", "Tuti Alawiyah",
  "Umar Hidayat", "Vina Melati", "Wahyu Nugroho", "Yulianti Rahayu", "Zainal Abidin",
  "Agus Salim", "Bella Safitri", "Candra Wibawa", "Diah Permata", "Erwin Susanto",
  "Farah Diba", "Guntur Prabowo", "Hana Kartika", "Iwan Setiawan", "Jasmine Putri",
  "Kevin Halim", "Lina Marlia", "Mochtar Riady", "Nia Ramadhani", "Omar Syarief",
  "Prita Ghozie", "Qonita Zahra", "Rudi Hartono", "Sri Mulyani", "Taufik Ismail",
  "Uci Nurul", "Vera Anggraini", "Wisnu Wardhana",
] as const;

export async function seedOrgUnits(orgId: string): Promise<void> {
  const idToUuid = new Map<string, string>();

  for (const def of ORG_UNIT_DEFS) {
    const [row] = await OrgUnit.findOrCreate({
      where: { orgId, name: def.name },
      defaults: { orgId, name: def.name, tier: def.tier, parentId: null, appt: {} },
    });
    idToUuid.set(def.id, row.id);
  }
  for (const def of ORG_UNIT_DEFS) {
    if (!def.parent) continue;
    const unit = await OrgUnit.findOne({ where: { orgId, name: def.name } });
    const parentUuid = idToUuid.get(def.parent) ?? null;
    if (unit && unit.parentId !== parentUuid) {
      unit.parentId = parentUuid;
      await unit.save();
    }
  }

  let seq = 0;
  for (const def of ORG_UNIT_DEFS) {
    const unitUuid = idToUuid.get(def.id)!;
    const appt: Record<string, string> = {};
    for (const level of def.levels) {
      seq += 1;
      const username = `orgunit${seq}`;
      const fullName = NAME_POOL[(seq - 1) % NAME_POOL.length];
      const [user] = await User.findOrCreate({
        where: { username },
        defaults: {
          orgId, tenantId: orgId, fullName, username, email: `${username}@axia-demo.local`,
          passwordHash: null, status: "Active", position: LEVEL_TITLE[level] ?? level,
          orgUnitId: unitUuid, empLevel: level, system: false,
        },
      });
      if (user.orgUnitId !== unitUuid || user.empLevel !== level) {
        user.orgUnitId = unitUuid;
        user.empLevel = level;
        await user.save();
      }
      appt[level] = user.id;
    }
    const unit = await OrgUnit.findByPk(unitUuid);
    if (unit && JSON.stringify(unit.appt) !== JSON.stringify(appt)) {
      unit.appt = appt;
      await unit.save();
    }
  }
}
