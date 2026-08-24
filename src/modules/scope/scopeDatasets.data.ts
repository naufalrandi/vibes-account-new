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

// OD `MS_ENV_DESC` (fe-vibes-new-od/index.html:9366-9393) — one description per
// SCOPE_ENVS entry, in SCOPE_ENVS order.
export const SCOPE_ENV_DESC: Record<string, string> = {
  "Production Environment": "Live environment serving real users and production data.",
  "Development Environment": "Environment used by engineers to build and iterate on features.",
  "Testing / Staging Environment": "Pre-production environment for integration and regression testing.",
  "User Acceptance Testing Environment": "Environment where business users validate functionality before release.",
  "Sandbox Environment": "Isolated environment for experimentation without affecting other systems.",
  "Disaster Recovery Environment": "Standby environment used to restore operations after a major disruption.",
  "Backup Environment": "Environment holding backup copies of systems and data.",
  "Cloud Infrastructure": "Cloud-hosted compute, storage, and networking resources.",
  "SaaS Applications": "Third-party software-as-a-service applications used by the organization.",
  "Internal SaaS Workspace": "The organization’s own tenant or workspace within a shared SaaS platform.",
  "Customer Portal": "External-facing portal used by customers to access services.",
  "Admin Portal": "Administrative portal for managing the platform or service.",
  "Internal Admin Portal": "Internal-only administrative console.",
  "Source Code Repository": "System that stores and version-controls application source code.",
  "CI/CD Pipeline": "Automated build, test, and deployment pipeline.",
  "Ticketing System": "System for logging and tracking issues or service requests.",
  "Document Repository": "Central store for controlled documents and records.",
  "Knowledge Base": "Repository of articles, guidance, and reference material.",
  "Data Warehouse": "Central repository for integrated and historical data.",
  "Analytics Platform": "Platform for reporting, dashboards, and data analysis.",
  "Identity Provider": "System managing authentication and user identities (SSO).",
  "Email System": "Corporate email and messaging service.",
  "Collaboration Platform": "Platform for team communication and collaboration.",
  "Monitoring Platform": "System monitoring availability and performance of services.",
  "Logging Platform": "Centralized log collection and analysis platform.",
  "Endpoint Management Platform": "System for managing and securing endpoint devices.",
};

// OD `MS_PERSONNEL_DEFS` (app.html:15249).
export const SCOPE_PERSONNEL_DESC: Record<string, string> = {
  "Employee (Permanent Contract)": "Directly employed staff on an open-ended, permanent employment contract.",
  "Employee (Fixed-Duration Contract)": "Directly employed staff on a fixed-term / fixed-duration employment contract.",
  "Intern": "Trainees or apprentices on an internship or work-placement arrangement — temporary and supervised.",
  "Contractor": "External individuals or third-party personnel engaged under a service or contractor agreement, not on payroll.",
};

// OD `MS_DEP_DESC` (index.html:9414-9505) — one description per SCOPE_DEPS entry.
export const SCOPE_DEP_DESC: Record<string, string> = {
  "Cloud Hosting Provider": "Hosts the organization’s applications and systems in the cloud.",
  "Cloud Platform Provider": "Provides the cloud platform and managed services used.",
  "Data Center Provider": "Provides data-center facilities, colocation, or hosting space.",
  "Server Hosting Provider": "Hosts physical or virtual servers for the organization.",
  "Network Provider": "Provides corporate network connectivity and transport.",
  "Internet Service Provider": "Provides internet connectivity for sites and users.",
  "DNS Provider": "Manages domain name resolution and DNS records.",
  "CDN Provider": "Delivers content via a content delivery network.",
  "Backup Service Provider": "Provides backup and data-protection services.",
  "Disaster Recovery Provider": "Provides disaster-recovery capability and failover.",
  "Infrastructure Monitoring Provider": "Monitors infrastructure availability and performance.",
  "SaaS Application Provider": "Supplies a software-as-a-service application in use.",
  "Business Application Provider": "Supplies a core business application.",
  "Identity Provider": "Manages authentication, SSO, and user identities.",
  "Email Service Provider": "Provides corporate email and messaging.",
  "Collaboration Tool Provider": "Provides team collaboration and communication tools.",
  "Ticketing System Provider": "Provides the issue or service-ticketing system.",
  "Document Management Provider": "Provides document storage and management.",
  "Source Code Repository Provider": "Hosts and version-controls source code.",
  "CI/CD Platform Provider": "Provides build, test, and deployment automation.",
  "Logging Platform Provider": "Provides centralized log collection and analysis.",
  "Analytics Platform Provider": "Provides analytics, reporting, and dashboards.",
  "Endpoint Management Provider": "Manages and secures endpoint devices.",
  "Security Monitoring Provider": "Monitors security events and alerts.",
  "SOC Provider": "Operates a security operations center for the organization.",
  "Vulnerability Assessment Provider": "Performs vulnerability scanning and assessment.",
  "Penetration Testing Provider": "Conducts penetration-testing engagements.",
  "Threat Intelligence Provider": "Supplies threat-intelligence feeds and analysis.",
  "Endpoint Security Provider": "Provides endpoint protection and anti-malware.",
  "Firewall / Network Security Provider": "Provides firewall and network-security services.",
  "IAM / SSO Provider": "Provides identity and access management / single sign-on.",
  "Security Consultant": "Provides information-security advisory services.",
  "Incident Response Provider": "Provides incident-response and forensics support.",
  "Consultant": "Provides general advisory or consulting services.",
  "External Auditor": "Conducts independent external audits.",
  "Legal Advisor": "Provides legal advice and counsel.",
  "Tax Advisor": "Provides tax advisory and compliance services.",
  "HR Consultant": "Provides human-resources advisory services.",
  "Management System Consultant": "Advises on management-system implementation.",
  "Certification Body": "Provides third-party certification and audits.",
  "Training Provider": "Delivers training and competence development.",
  "Recruitment Provider": "Provides recruitment and staffing services.",
  "Outsourced Developer": "Provides outsourced software development.",
  "Outsourced IT Support": "Provides outsourced IT support services.",
  "Office Supplier": "Supplies office materials and consumables.",
  "Equipment Supplier": "Supplies operational or production equipment.",
  "Laboratory Equipment Supplier": "Supplies laboratory equipment and instruments.",
  "Calibration Service Provider": "Provides equipment calibration services.",
  "Maintenance Service Provider": "Provides equipment or facility maintenance.",
  "Facility Management Provider": "Manages facilities and building services.",
  "Cleaning Service Provider": "Provides cleaning and janitorial services.",
  "Security Guard Provider": "Provides physical security and guarding.",
  "Courier / Logistics Provider": "Provides courier and logistics services.",
  "Transportation Provider": "Provides transportation of goods or people.",
  "Payment Provider": "Processes payments for the organization.",
  "Payment Gateway": "Provides online payment gateway services.",
  "Customer Support Provider": "Provides outsourced customer support.",
  "Call Center Provider": "Operates call-center services.",
  "CRM Provider": "Provides customer relationship management software.",
  "Marketing Platform Provider": "Provides marketing and campaign tools.",
  "Survey Platform Provider": "Provides survey and feedback collection.",
  "External Laboratory": "Performs external testing or analysis.",
  "Inspection Provider": "Provides inspection services.",
  "Subcontracted Service Provider": "Delivers subcontracted services for the organization.",
  "Data Processor": "Processes personal data on the organization’s behalf.",
  "Data Sub-processor": "Processes personal data on behalf of a data processor.",
  "Data Storage Provider": "Stores organizational or personal data.",
  "Data Analytics Provider": "Performs data analytics on the organization’s data.",
  "Personal Data Processing Vendor": "Handles personal-data processing activities.",
  "Records Retention Provider": "Provides records-retention and archival services.",
  "Archiving Provider": "Provides long-term archiving of data and records.",
  "Licensing Authority": "Issues licenses and permits the organization requires.",
  "Regulatory Portal": "Government portal for regulatory submissions.",
  "Government Reporting System": "System for mandatory government reporting.",
  "Industry Association": "Industry body providing standards or membership.",
  "Accreditation Body": "Accredits certification bodies or laboratories.",
  "Certification Scheme Owner": "Owns the certification scheme or standard.",
  "Insurance Provider": "Provides insurance coverage.",
  "Banking Provider": "Provides banking and financial services.",
  "Utility Provider": "Provides utilities such as power and water.",
  "Emergency Response Provider": "Provides emergency-response services.",
  "Medical Service Provider": "Provides occupational-health or medical services.",
  "Waste Management Provider": "Provides waste collection and disposal.",
  "Environmental Service Provider": "Provides environmental services.",
};

export const SCOPE_DATASET_KINDS = ["env", "ptype", "dep"] as const;
export type ScopeDatasetKind = (typeof SCOPE_DATASET_KINDS)[number];

/** Flat seed rows (org_id NULL = SP-global). */
export function scopeDatasetSeed(): { kind: string; name: string; category: string | null; description: string | null; status: string }[] {
  const rows: { kind: string; name: string; category: string | null; description: string | null; status: string }[] = [];
  for (const name of SCOPE_ENVS) rows.push({ kind: "env", name, category: null, description: SCOPE_ENV_DESC[name] ?? null, status: "Active" });
  for (const name of SCOPE_PERSONNEL) rows.push({ kind: "ptype", name, category: null, description: SCOPE_PERSONNEL_DESC[name] ?? null, status: "Active" });
  for (const g of SCOPE_DEPS) for (const name of g.names) rows.push({ kind: "dep", name, category: g.category, description: SCOPE_DEP_DESC[name] ?? null, status: "Active" });
  return rows;
}
