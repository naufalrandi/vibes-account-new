/**
 * The platform feature modules used by the Team Management permission grid. Each
 * key matches an AXIA module and a sidebar nav group; the label is the display
 * name shown in the permission checkboxes and permission summaries.
 */
export interface ModuleDef {
  key: string;
  label: string;
}

export const MODULES: ModuleDef[] = [
  { key: "team", label: "Team Management" },
  { key: "partner", label: "Partner Management" },
  { key: "tenant", label: "Tenant Management" },
  { key: "framework", label: "Framework Management" },
  { key: "billing", label: "Billing Management" },
  { key: "ticket", label: "Ticket Management" },
];
