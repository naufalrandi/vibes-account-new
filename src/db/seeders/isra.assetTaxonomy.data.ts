// GENERATED FILE — do not edit by hand.
// Produced from the live Open-Design prototype by booting it headlessly and
// reading its own seeded `db` (see fe-vibes-new/tools/od-boot.cjs). OD fills
// most of these collections lazily, on first render of the owning screen, so
// the boot harness walks every persona, company, area and client edition
// before reading. Regenerate with:
//
//   cd fe-vibes-new && node tools/regen-od-data.cjs

/**
 * The ISRA asset taxonomy — OD's Primary/Secondary asset Group -> Subgroup trees
 * and the seeded asset libraries that hang off them.
 *
 * These are the FK targets `isra_km_sa_threat` and `isra_km_threat_vuln` point
 * at through `subgroupId`; until they exist, `seedIsraLibrary()` has to skip
 * every KM row whose subgroup cannot resolve.
 *
 *   isra_pa_groups                   5
 *   isra_pa_subgroups               16
 *   isra_sa_groups                  10
 *   isra_sa_subgroups               39
 *   isra_primary_asset_library      10
 *   isra_secondary_asset_library    16
 *   secondary type/subtype pairs    16
 */

export interface IsraGroupSeedRow { id: string; name: string }
export interface IsraPaSubgroupSeedRow {
  id: string; groupId: string; name: string;
  description: string | null; examples: readonly string[];
}
export interface IsraSaSubgroupSeedRow extends IsraPaSubgroupSeedRow {
  status: string; version: number;
}
export interface IsraPrimaryAssetSeedRow {
  id: string; name: string; category: string | null;
  groupId: string | null; subgroupId: string | null;
  cia: Record<string, unknown>; privacy: boolean;
  typicalSecondary: readonly string[];
}
export interface IsraSecondaryAssetSeedRow {
  id: string; name: string; groupId: string | null;
  subgroupId: string | null; description: string | null;
}
export interface IsraSaTypeSeedRow { type: string; subtype: string }

export const ISRA_PA_GROUP_SEED: readonly IsraGroupSeedRow[] = [
  {"id":"PAG-001","name":"Personal Data"},
  {"id":"PAG-002","name":"Source Code"},
  {"id":"PAG-003","name":"System Data"},
  {"id":"PAG-004","name":"Configuration Data"},
  {"id":"PAG-005","name":"Business Records"},
];

export const ISRA_PA_SUBGROUP_SEED: readonly IsraPaSubgroupSeedRow[] = [
  {"id":"PSG-001","groupId":"PAG-001","name":"Personnel Personal Data","description":"Personal data relating to employees, contractors, job applicants, former personnel, and other individuals working for or on behalf of the organization.","examples":["Employee identity details","personnel files","payroll details","attendance records","performance records","job applicant data","contractor personal data","emergency contact details"]},
  {"id":"PSG-002","groupId":"PAG-001","name":"Non-Personnel Personal Data","description":"Personal data relating to customers, users, prospects, suppliers, visitors, beneficiaries, and other individuals who are not part of the organization's workforce.","examples":["Customer profiles","user registration details","contact information","customer identification records","visitor records","prospect information","supplier contact details","customer communication history"]},
  {"id":"PSG-003","groupId":"PAG-002","name":"Web and Mobile Application Source Code","description":"Human-readable code and associated development artifacts used to build browser-based websites, web applications, and mobile applications.","examples":["Website source code","frontend application code","Android application code","iOS application code","client-side scripts","user-interface components","application build files"]},
  {"id":"PSG-004","groupId":"PAG-002","name":"Backend, API and Service Source Code","description":"Human-readable code used to implement server-side applications, APIs, background services, integration services, and business logic.","examples":["Backend service code","REST API code","GraphQL service code","microservice code","authentication service code","integration service code","scheduled job code","server-side business logic"]},
  {"id":"PSG-005","groupId":"PAG-002","name":"Automation and Infrastructure Code","description":"Code and machine-readable definitions used to automate infrastructure provisioning, deployment, configuration, testing, and operational tasks.","examples":["Infrastructure-as-code templates","deployment scripts","CI/CD pipeline definitions","container build files","orchestration manifests","database migration scripts","test automation code","administrative scripts"]},
  {"id":"PSG-006","groupId":"PAG-003","name":"Application and Transactional Data","description":"Structured or operational data created, received, updated, or processed as part of an application's or information system's normal business functions.","examples":["Customer account data","order transactions","payment transaction records","application content","inventory data","workflow records","service requests","application-generated operational data"]},
  {"id":"PSG-007","groupId":"PAG-003","name":"Identity and Credential Data","description":"Data used by information systems to identify users, authenticate identities, authorize access, or maintain authentication state.","examples":["User account records","usernames","password hashes","authentication tokens","session tokens","recovery codes","authorization attributes","service-account identities","credential metadata"]},
  {"id":"PSG-008","groupId":"PAG-003","name":"Logs and Audit Data","description":"System-generated records that document activities, events, access, transactions, errors, security events, or changes within an information system.","examples":["Application logs","audit trails","access logs","authentication logs","network logs","security event records","database audit logs","administrative activity logs","error logs"]},
  {"id":"PSG-009","groupId":"PAG-004","name":"Application Configuration","description":"Configuration information that determines how an application or service operates, connects to dependencies, and enables or restricts functionality.","examples":["Application settings","environment parameters","feature flags","service endpoints","connection parameters","runtime settings","integration configuration","application secrets"]},
  {"id":"PSG-010","groupId":"PAG-004","name":"Server and Infrastructure Configuration","description":"Configuration information defining the operation of servers, operating systems, cloud resources, containers, virtualization platforms, and supporting infrastructure.","examples":["Operating-system settings","server hardening settings","cloud resource configuration","virtual-machine configuration","container configuration","storage configuration","infrastructure deployment parameters"]},
  {"id":"PSG-011","groupId":"PAG-004","name":"Network and Security Configuration","description":"Configuration information governing network connectivity, traffic control, security enforcement, remote access, and network monitoring.","examples":["Firewall rules","router configuration","switch configuration","access-control lists","VPN configuration","proxy rules","intrusion-detection rules","network segmentation rules","security gateway settings"]},
  {"id":"PSG-012","groupId":"PAG-004","name":"Domain and DNS Configuration","description":"Configuration information used to manage domain ownership, name resolution, routing, and related internet-facing trust settings.","examples":["DNS zone records","domain registration details","nameserver settings","mail-routing records","subdomain configuration","domain verification records","certificate-related domain configuration"]},
  {"id":"PSG-013","groupId":"PAG-005","name":"Operational Records","description":"Records retained as evidence of routine business operations, service delivery, commercial activities, and organizational transactions.","examples":["Purchase orders","sales records","service-delivery records","inventory records","support tickets","work orders","supplier records","operational reports","correspondence records"]},
  {"id":"PSG-014","groupId":"PAG-005","name":"Financial Records","description":"Records documenting the organization's financial transactions, position, obligations, reporting, and accounting activities.","examples":["Invoices","receipts","accounting ledgers","expense records","tax records","bank reconciliation records","budgets","financial statements","payment records"]},
  {"id":"PSG-015","groupId":"PAG-005","name":"Legal and Compliance Records","description":"Records retained to demonstrate legal rights, obligations, regulatory compliance, contractual commitments, investigations, and formal assurance activities.","examples":["Contracts","licenses","regulatory submissions","compliance assessments","legal correspondence","consent records","audit reports","investigation records","policy attestations","data-processing agreements"]},
  {"id":"PSG-016","groupId":"PAG-005","name":"Governance and Management Records","description":"Records documenting organizational direction, oversight, decisions, policies, risk management, and management activities.","examples":["Board minutes","management decisions","policies","procedures","risk registers","strategic plans","committee records","management reports","internal approvals","governance documentation"]},
];

export const ISRA_SA_GROUP_SEED: readonly IsraGroupSeedRow[] = [
  {"id":"SAG-001","name":"Communication Services"},
  {"id":"SAG-002","name":"Documents and Records"},
  {"id":"SAG-003","name":"Facilities and Environment"},
  {"id":"SAG-004","name":"Computing Hardware"},
  {"id":"SAG-005","name":"Personnel"},
  {"id":"SAG-006","name":"Network and Security Infrastructure"},
  {"id":"SAG-007","name":"Applications and Software"},
  {"id":"SAG-008","name":"Storage and Backup"},
  {"id":"SAG-009","name":"Cloud and Virtual Infrastructure"},
  {"id":"SAG-010","name":"External and Managed Services"},
];

export const ISRA_SA_SUBGROUP_SEED: readonly IsraSaSubgroupSeedRow[] = [
  {"id":"SSG-001","groupId":"SAG-001","name":"Email Services","description":"Services used to create, transmit, receive, route, filter, or retain electronic mail.","examples":["Microsoft Exchange","Microsoft 365 Email","Gmail","email gateways","mail relays","email filtering services"],"status":"Under review","version":2},
  {"id":"SSG-002","groupId":"SAG-001","name":"Messaging Services","description":"Services used for real-time or asynchronous text, file, and collaborative messaging.","examples":["Microsoft Teams messaging","Slack","WhatsApp Business","internal chat platforms","collaboration channels"],"status":"Under review","version":2},
  {"id":"SSG-003","groupId":"SAG-001","name":"Video Conferencing Services","description":"Services used to conduct virtual meetings, video calls, screen sharing, and online collaboration sessions.","examples":["Microsoft Teams meetings","Zoom","Google Meet","Webex","internal conferencing platforms"],"status":"Under review","version":2},
  {"id":"SSG-004","groupId":"SAG-001","name":"Voice and Telephony Services","description":"Services and infrastructure used for voice calls, telephone communications, and IP-based telephony.","examples":["VoIP systems","IP-PBX","desk-phone services","softphones","call-centre telephony","mobile voice services"],"status":"Under review","version":2},
  {"id":"SSG-005","groupId":"SAG-002","name":"Physical Identity Documents","description":"Physical documents used to establish, verify, or represent an individual's identity or authorization.","examples":["Identity cards","passports","access badges","employee cards","visitor passes","physical credentials"],"status":"Under review","version":2},
  {"id":"SSG-006","groupId":"SAG-002","name":"Paper Documents and Records","description":"Information recorded or retained on paper or another non-electronic document medium.","examples":["Printed contracts","paper forms","signed approvals","personnel files","printed reports","paper correspondence"],"status":"Under review","version":2},
  {"id":"SSG-007","groupId":"SAG-002","name":"Electronic Documents and Files","description":"Discrete electronic documents or files used to record, exchange, or retain information.","examples":["Word documents","PDF files","spreadsheets","Google Docs files","presentations","scanned documents","electronic forms"],"status":"Under review","version":2},
  {"id":"SSG-008","groupId":"SAG-003","name":"Data Centres and Server Rooms","description":"Controlled physical locations that house servers, storage, network equipment, and supporting technology.","examples":["Data centres","server rooms","equipment rooms","colocation facilities","secure computing rooms"],"status":"Under review","version":2},
  {"id":"SSG-009","groupId":"SAG-003","name":"Wiring and Telecommunications Rooms","description":"Physical locations containing network cabling, telecommunications termination, and distribution equipment.","examples":["Wiring closets","telecommunications rooms","patch-panel rooms","cable distribution areas","network cabinets"],"status":"Under review","version":2},
  {"id":"SSG-010","groupId":"SAG-003","name":"Power, Cooling and Environmental Systems","description":"Systems that provide power, temperature control, fire protection, and environmental support for information-processing facilities.","examples":["HVAC systems","UPS systems","generators","power distribution units","fire-suppression systems","environmental sensors"],"status":"Under review","version":2},
  {"id":"SSG-011","groupId":"SAG-004","name":"End-User Computers","description":"Physical computing devices used by personnel to access, process, or store organizational information.","examples":["Laptops","desktop computers","engineering workstations","thin clients","administrative workstations"],"status":"Under review","version":2},
  {"id":"SSG-012","groupId":"SAG-004","name":"Mobile Devices","description":"Portable computing and communication devices used to access or process organizational information.","examples":["Smartphones","tablets","rugged mobile devices","corporate mobile phones","handheld terminals"],"status":"Under review","version":2},
  {"id":"SSG-013","groupId":"SAG-004","name":"Physical Servers","description":"Physical server hardware used to host applications, databases, storage, security services, or infrastructure functions.","examples":["Rack servers","blade servers","application servers","database servers","directory servers","physical host servers"],"status":"Under review","version":2},
  {"id":"SSG-014","groupId":"SAG-005","name":"Employees and Internal Personnel","description":"Individuals directly employed by the organization who operate, administer, use, or support information and information systems.","examples":["Employees","managers","internal IT personnel","developers","system operators","security personnel"],"status":"Under review","version":2},
  {"id":"SSG-015","groupId":"SAG-005","name":"Contractors and External Personnel","description":"Non-employees who access, operate, support, develop, or otherwise interact with organizational information and systems.","examples":["Contractors","consultants","outsourced personnel","supplier personnel","external support engineers","temporary specialists"],"status":"Under review","version":2},
  {"id":"SSG-016","groupId":"SAG-006","name":"Firewalls and Security Gateways","description":"Network security components that inspect, permit, restrict, filter, or secure traffic between systems or network zones.","examples":["Network firewalls","web application firewalls","secure web gateways","email security gateways","VPN gateways"],"status":"Under review","version":2},
  {"id":"SSG-017","groupId":"SAG-006","name":"Routers and Network Gateways","description":"Network components that route traffic and provide connectivity between networks, sites, or external services.","examples":["Routers","edge routers","internet gateways","SD-WAN gateways","branch gateways","cloud network gateways"],"status":"Under review","version":2},
  {"id":"SSG-018","groupId":"SAG-006","name":"Switches and Wireless Infrastructure","description":"Network components that provide local connectivity and wireless network access.","examples":["Network switches","core switches","access switches","wireless controllers","wireless access points","network bridges"],"status":"Under review","version":2},
  {"id":"SSG-019","groupId":"SAG-006","name":"Network Monitoring and Detection Systems","description":"Systems used to observe network activity, detect suspicious traffic, and generate network-security telemetry.","examples":["Network IDS","network IPS","network monitoring platforms","packet sensors","network detection and response systems"],"status":"Under review","version":2},
  {"id":"SSG-020","groupId":"SAG-007","name":"Web and Mobile Applications","description":"Software applications accessed through web browsers or installed on mobile devices.","examples":["Customer web applications","internal portals","e-commerce websites","Android applications","iOS applications","progressive web applications"],"status":"Under review","version":2},
  {"id":"SSG-021","groupId":"SAG-007","name":"Backend Services and APIs","description":"Server-side software services and interfaces that implement application logic or expose system functionality.","examples":["REST APIs","GraphQL APIs","microservices","authentication services","background services","application backends"],"status":"Under review","version":2},
  {"id":"SSG-022","groupId":"SAG-007","name":"Operating Systems","description":"System software that manages hardware resources and provides the execution environment for applications.","examples":["Windows Server","Windows desktop","Linux","macOS","Android","iOS","Unix operating systems"],"status":"Under review","version":2},
  {"id":"SSG-023","groupId":"SAG-007","name":"Database Management Systems","description":"Software platforms or managed services used to create, operate, query, and administer databases.","examples":["PostgreSQL","MySQL","Microsoft SQL Server","Oracle Database","MongoDB","managed relational database services"],"status":"Under review","version":2},
  {"id":"SSG-024","groupId":"SAG-007","name":"Security Applications","description":"Software used to prevent, detect, investigate, monitor, or respond to information-security events.","examples":["SIEM platforms","endpoint protection","vulnerability scanners","identity security tools","security orchestration platforms"],"status":"Under review","version":2},
  {"id":"SSG-025","groupId":"SAG-007","name":"Integration and Middleware Services","description":"Software and services used to exchange, transform, route, or coordinate data between applications and systems.","examples":["API gateways","enterprise service buses","message brokers","integration platforms","middleware","data-exchange services"],"status":"Under review","version":2},
  {"id":"SSG-026","groupId":"SAG-007","name":"Development and Deployment Platforms","description":"Platforms supporting source-code management, software builds, testing, deployment, and delivery automation.","examples":["Source-code repositories","Git platforms","CI/CD pipelines","artifact repositories","build servers","deployment platforms"],"status":"Under review","version":2},
  {"id":"SSG-027","groupId":"SAG-008","name":"Backup Media","description":"Media specifically used to retain offline, archival, or transportable backup copies.","examples":["Backup tapes","tape cartridges","archival discs","offline backup media","removable backup sets"],"status":"Under review","version":2},
  {"id":"SSG-028","groupId":"SAG-008","name":"External and Removable Storage","description":"Portable or externally connected media used to store or transfer information.","examples":["External hard drives","USB drives","removable SSDs","memory cards","optical media"],"status":"Under review","version":2},
  {"id":"SSG-029","groupId":"SAG-008","name":"Network and Enterprise Storage","description":"Shared or centralized storage systems accessed through organizational or storage networks.","examples":["NAS systems","SAN systems","storage arrays","file servers","shared storage appliances","object-storage platforms"],"status":"Under review","version":2},
  {"id":"SSG-030","groupId":"SAG-008","name":"Backup and Recovery Systems","description":"Software, appliances, and services used to create, manage, restore, and monitor backups.","examples":["Backup servers","backup applications","recovery platforms","replication services","backup appliances","disaster-recovery systems"],"status":"Under review","version":2},
  {"id":"SSG-031","groupId":"SAG-009","name":"Virtual Machines","description":"Software-defined computing environments that emulate physical computers and run operating systems or applications.","examples":["Cloud virtual machines","on-premises virtual servers","virtual desktops","hypervisor-hosted guests"],"status":"Under review","version":2},
  {"id":"SSG-032","groupId":"SAG-009","name":"Containers and Orchestration Platforms","description":"Containerized execution environments and the platforms used to deploy, coordinate, and manage them.","examples":["Docker containers","Kubernetes clusters","container registries","container runtimes","orchestration platforms"],"status":"Under review","version":2},
  {"id":"SSG-033","groupId":"SAG-009","name":"Infrastructure-as-a-Service Resources","description":"Cloud-provided computing, networking, and infrastructure resources managed by the organization.","examples":["Cloud compute instances","virtual networks","cloud load balancers","cloud security groups","cloud infrastructure resources"],"status":"Under review","version":2},
  {"id":"SSG-034","groupId":"SAG-009","name":"Platform-as-a-Service Resources","description":"Managed cloud platforms used to deploy or operate applications without directly managing the underlying infrastructure.","examples":["Managed application platforms","serverless functions","managed integration platforms","managed runtime services","cloud application platforms"],"status":"Under review","version":2},
  {"id":"SSG-035","groupId":"SAG-009","name":"Cloud Storage Services","description":"Cloud-hosted services used to store files, objects, volumes, archives, or backups.","examples":["Object storage","cloud file storage","cloud block storage","cloud archives","managed backup storage"],"status":"Under review","version":2},
  {"id":"SSG-036","groupId":"SAG-010","name":"Cloud Service Providers","description":"External organizations providing hosted infrastructure, platforms, applications, or cloud-based supporting services.","examples":["Public cloud providers","SaaS providers","hosted platform providers","cloud security providers"],"status":"Under review","version":2},
  {"id":"SSG-037","groupId":"SAG-010","name":"Managed Service Providers","description":"External organizations that operate, administer, monitor, support, or secure information systems on behalf of the organization.","examples":["Managed IT providers","managed security providers","outsourced operations centres","external support providers"],"status":"Under review","version":2},
  {"id":"SSG-038","groupId":"SAG-010","name":"Telecommunications Providers","description":"External organizations providing internet, voice, mobile, or data-connectivity services.","examples":["Internet service providers","mobile network operators","leased-line providers","telephony providers","data-carrier services"],"status":"Under review","version":2},
  {"id":"SSG-039","groupId":"SAG-010","name":"External APIs and Platforms","description":"Externally operated digital platforms or interfaces on which an organizational process or information system depends.","examples":["Payment gateways","identity providers","external APIs","e-signature platforms","customer communication platforms","third-party data services"],"status":"Under review","version":2},
];

export const ISRA_PRIMARY_ASSET_SEED: readonly IsraPrimaryAssetSeedRow[] = [
  {"id":"PAL-001","name":"Customer Personal Data","category":"Personal Data","groupId":"PAG-001","subgroupId":"PSG-002","cia":{"summary":"C:High I:High A:Med"},"privacy":true,"typicalSecondary":["Customer Web Application","Customer Database","CRM Platform","Logistics Integration API"]},
  {"id":"PAL-002","name":"Employee Personal Data","category":"Personal Data","groupId":"PAG-001","subgroupId":"PSG-001","cia":{"summary":"C:High I:High A:Med"},"privacy":true,"typicalSecondary":["HR Information System","HR Document Repository","Payroll Application","Bank File Transfer Service"]},
  {"id":"PAL-003","name":"Web Application Source Code","category":"Source Code","groupId":"PAG-002","subgroupId":"PSG-003","cia":{"summary":"C:High I:High A:High"},"privacy":false,"typicalSecondary":["Source Code Repository","Developer Workstation","CI/CD Pipeline","Artifact Repository"]},
  {"id":"PAL-004","name":"Web Application Database","category":"System Data","groupId":"PAG-003","subgroupId":"PSG-006","cia":{"summary":"C:High I:High A:High"},"privacy":false,"typicalSecondary":["Web Application Backend","Database Credential Store","Managed Database Service","Database Backup Storage"]},
  {"id":"PAL-005","name":"Payment & Transaction Data","category":"System Data","groupId":"PAG-003","subgroupId":"PSG-006","cia":{"summary":"C:High I:High A:High"},"privacy":false,"typicalSecondary":["Customer Web Application","Customer Database","CRM Platform","Logistics Integration API","HR Information System","HR Document Repository","Payroll Application","Bank File Transfer Service","Source Code Repository","Developer Workstation","CI/CD Pipeline","Artifact Repository","Web Application Backend","Database Credential Store","Managed Database Service","Database Backup Storage"]},
  {"id":"PAL-006","name":"System Credentials & Secrets","category":"System Data","groupId":"PAG-003","subgroupId":"PSG-007","cia":{"summary":"C:Critical I:High A:High"},"privacy":false,"typicalSecondary":["Customer Web Application","Customer Database","CRM Platform","Logistics Integration API","HR Information System","HR Document Repository","Payroll Application","Bank File Transfer Service","Source Code Repository","Developer Workstation","CI/CD Pipeline","Artifact Repository","Web Application Backend","Database Credential Store","Managed Database Service","Database Backup Storage"]},
  {"id":"PAL-007","name":"Security & Audit Logs","category":"System Data","groupId":"PAG-003","subgroupId":"PSG-008","cia":{"summary":"C:Med I:High A:Med"},"privacy":false,"typicalSecondary":["Customer Web Application","Customer Database","CRM Platform","Logistics Integration API","HR Information System","HR Document Repository","Payroll Application","Bank File Transfer Service","Source Code Repository","Developer Workstation","CI/CD Pipeline","Artifact Repository","Web Application Backend","Database Credential Store","Managed Database Service","Database Backup Storage"]},
  {"id":"PAL-008","name":"Infrastructure Configuration","category":"Configuration Data","groupId":"PAG-004","subgroupId":"PSG-010","cia":{"summary":"C:High I:High A:High"},"privacy":false,"typicalSecondary":["Customer Web Application","Customer Database","CRM Platform","Logistics Integration API","HR Information System","HR Document Repository","Payroll Application","Bank File Transfer Service","Source Code Repository","Developer Workstation","CI/CD Pipeline","Artifact Repository","Web Application Backend","Database Credential Store","Managed Database Service","Database Backup Storage"]},
  {"id":"PAL-009","name":"Financial Records","category":"Business Records","groupId":"PAG-005","subgroupId":"PSG-014","cia":{"summary":"C:High I:High A:Med"},"privacy":false,"typicalSecondary":["Customer Web Application","Customer Database","CRM Platform","Logistics Integration API","HR Information System","HR Document Repository","Payroll Application","Bank File Transfer Service","Source Code Repository","Developer Workstation","CI/CD Pipeline","Artifact Repository","Web Application Backend","Database Credential Store","Managed Database Service","Database Backup Storage"]},
  {"id":"PAL-010","name":"Legal & Compliance Records","category":"Business Records","groupId":"PAG-005","subgroupId":"PSG-015","cia":{"summary":"C:Med I:High A:Med"},"privacy":false,"typicalSecondary":["Customer Web Application","Customer Database","CRM Platform","Logistics Integration API","HR Information System","HR Document Repository","Payroll Application","Bank File Transfer Service","Source Code Repository","Developer Workstation","CI/CD Pipeline","Artifact Repository","Web Application Backend","Database Credential Store","Managed Database Service","Database Backup Storage"]},
];

export const ISRA_SECONDARY_ASSET_SEED: readonly IsraSecondaryAssetSeedRow[] = [
  {"id":"SAL-001","name":"Customer Web Application","groupId":"SAG-007","subgroupId":"SSG-020","description":"Browser-based application customers use to register, sign in, and manage their accounts and orders."},
  {"id":"SAL-002","name":"Customer Database","groupId":"SAG-007","subgroupId":"SSG-023","description":"Relational database storing customer accounts, profiles, and transactional records for the web application."},
  {"id":"SAL-003","name":"CRM Platform","groupId":"SAG-007","subgroupId":"SSG-020","description":"Business application staff use to manage customer relationships, orders, and support interactions."},
  {"id":"SAL-004","name":"Logistics Integration API","groupId":"SAG-007","subgroupId":"SSG-025","description":"Integration API that exchanges order and shipment data with external logistics providers."},
  {"id":"SAL-005","name":"HR Information System","groupId":"SAG-007","subgroupId":"SSG-020","description":"Application used to manage employee records, the employment lifecycle, and core HR processes."},
  {"id":"SAL-006","name":"HR Document Repository","groupId":null,"subgroupId":null,"description":"Repository holding HR and personnel documents such as contracts, approvals, and personnel files."},
  {"id":"SAL-007","name":"Payroll Application","groupId":"SAG-007","subgroupId":"SSG-020","description":"Application that calculates and processes employee pay, deductions, and benefits."},
  {"id":"SAL-008","name":"Bank File Transfer Service","groupId":null,"subgroupId":null,"description":"External service used to transmit payment-instruction files to the organization’s bank."},
  {"id":"SAL-009","name":"Source Code Repository","groupId":"SAG-007","subgroupId":"SSG-026","description":"Version-controlled repository hosting application source code and its development history."},
  {"id":"SAL-010","name":"Developer Workstation","groupId":"SAG-004","subgroupId":"SSG-011","description":"End-user computer developers use to write, build, and test application code."},
  {"id":"SAL-011","name":"CI/CD Pipeline","groupId":"SAG-007","subgroupId":"SSG-026","description":"Automated build, test, and deployment pipeline that delivers application releases."},
  {"id":"SAL-012","name":"Artifact Repository","groupId":"SAG-007","subgroupId":"SSG-026","description":"Repository storing build artifacts and release packages produced by the pipeline."},
  {"id":"SAL-013","name":"Web Application Backend","groupId":"SAG-007","subgroupId":"SSG-021","description":"Server-side application services and APIs implementing the web application’s business logic."},
  {"id":"SAL-014","name":"Database Credential Store","groupId":null,"subgroupId":null,"description":"Secure store holding database credentials and cryptographic keys used by the application."},
  {"id":"SAL-015","name":"Managed Database Service","groupId":"SAG-007","subgroupId":"SSG-023","description":"Cloud-managed database platform that hosts and operates the application’s databases."},
  {"id":"SAL-016","name":"Database Backup Storage","groupId":null,"subgroupId":null,"description":"Storage retaining backup copies of the application databases for recovery."},
];

/** OD's `israSaTypes` — the type/subtype vocabulary the secondary-asset form offers. */
export const ISRA_SA_TYPE_SEED: readonly IsraSaTypeSeedRow[] = [
  {"type":"Application","subtype":"Public Web Application"},
  {"type":"Database","subtype":"Relational Database"},
  {"type":"Application","subtype":"SaaS Business Application"},
  {"type":"External Service","subtype":"Integration API"},
  {"type":"Application","subtype":"HR System"},
  {"type":"Document Repository","subtype":"Document Repository"},
  {"type":"Application","subtype":"Payroll System"},
  {"type":"External Service","subtype":"File Transfer Service"},
  {"type":"Repository","subtype":"Source Code Repository"},
  {"type":"Device","subtype":"Endpoint Workstation"},
  {"type":"Application","subtype":"CI/CD Pipeline"},
  {"type":"Repository","subtype":"Artifact Repository"},
  {"type":"Application","subtype":"Application Backend"},
  {"type":"Credential Repository","subtype":"Secrets Store"},
  {"type":"Infrastructure","subtype":"Managed Database Service"},
  {"type":"Storage","subtype":"Backup Storage"},
];
