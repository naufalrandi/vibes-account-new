/**
 * Service-Provider master pick-lists for the Management System Scope dimensions
 * (mirrors the design's MS_ENVS / MS_PERSONNEL / MS_DEPS). Seeded as SP-global
 * (org_id NULL) reference data; tenants pick from these when building a scope.
 */
export const SCOPE_ENVS: string[] = [
  "Production Environment", "Development Environment", "Testing / Staging Environment", "User Acceptance Testing Environment",
  "Sandbox Environment", "Disaster Recovery Environment", "Backup Environment", "Cloud Infrastructure", "SaaS Applications",
  "Internal SaaS Workspace", "Customer Portal", "Admin Portal", "Internal Admin Portal", "Source Code Repository",
  "CI/CD Pipeline", "Ticketing System", "Document Repository", "Knowledge Base", "Data Warehouse", "Analytics Platform",
  "Identity Provider", "Email System", "Collaboration Platform", "Monitoring Platform", "Logging Platform", "Endpoint Management Platform",
];

export const SCOPE_PERSONNEL: string[] = [
  "Employee (Permanent Contract)", "Employee (Fixed-Duration Contract)", "Intern", "Contractor",
];

export const SCOPE_DEPS: { category: string; names: string[] }[] = [
  { category: "Cloud and Infrastructure", names: ["Cloud Hosting Provider", "Cloud Platform Provider", "Data Center Provider", "Server Hosting Provider", "Network Provider", "Internet Service Provider", "DNS Provider", "CDN Provider", "Backup Service Provider", "Disaster Recovery Provider", "Infrastructure Monitoring Provider"] },
  { category: "Software and SaaS", names: ["SaaS Application Provider", "Business Application Provider", "Identity Provider", "Email Service Provider", "Collaboration Tool Provider", "Ticketing System Provider", "Document Management Provider", "Source Code Repository Provider", "CI/CD Platform Provider", "Logging Platform Provider", "Analytics Platform Provider", "Endpoint Management Provider"] },
  { category: "Information Security", names: ["Security Monitoring Provider", "SOC Provider", "Vulnerability Assessment Provider", "Penetration Testing Provider", "Threat Intelligence Provider", "Endpoint Security Provider", "Firewall / Network Security Provider", "IAM / SSO Provider", "Security Consultant", "Incident Response Provider"] },
  { category: "Professional Services", names: ["Consultant", "External Auditor", "Legal Advisor", "Tax Advisor", "HR Consultant", "Management System Consultant", "Certification Body", "Training Provider", "Recruitment Provider", "Outsourced Developer", "Outsourced IT Support"] },
  { category: "Operational Suppliers", names: ["Office Supplier", "Equipment Supplier", "Laboratory Equipment Supplier", "Calibration Service Provider", "Maintenance Service Provider", "Facility Management Provider", "Cleaning Service Provider", "Security Guard Provider", "Courier / Logistics Provider", "Transportation Provider"] },
  { category: "Customer and Service Delivery", names: ["Payment Provider", "Payment Gateway", "Customer Support Provider", "Call Center Provider", "CRM Provider", "Marketing Platform Provider", "Survey Platform Provider", "External Laboratory", "Inspection Provider", "Subcontracted Service Provider"] },
  { category: "Data and Privacy", names: ["Data Processor", "Data Sub-processor", "Data Storage Provider", "Data Analytics Provider", "Personal Data Processing Vendor", "Records Retention Provider", "Archiving Provider"] },
  { category: "Regulatory and Compliance Dependencies", names: ["Licensing Authority", "Regulatory Portal", "Government Reporting System", "Industry Association", "Accreditation Body", "Certification Scheme Owner"] },
  { category: "Other", names: ["Insurance Provider", "Banking Provider", "Utility Provider", "Emergency Response Provider", "Medical Service Provider", "Waste Management Provider", "Environmental Service Provider"] },
];

export const SCOPE_DATASET_KINDS = ["env", "ptype", "dep"] as const;
export type ScopeDatasetKind = (typeof SCOPE_DATASET_KINDS)[number];

/** Flat seed rows (org_id NULL = SP-global). */
export function scopeDatasetSeed(): { kind: string; name: string; category: string | null; description: string | null; status: string }[] {
  const rows: { kind: string; name: string; category: string | null; description: string | null; status: string }[] = [];
  for (const name of SCOPE_ENVS) rows.push({ kind: "env", name, category: null, description: null, status: "Active" });
  for (const name of SCOPE_PERSONNEL) rows.push({ kind: "ptype", name, category: null, description: null, status: "Active" });
  for (const g of SCOPE_DEPS) for (const name of g.names) rows.push({ kind: "dep", name, category: g.category, description: null, status: "Active" });
  return rows;
}
