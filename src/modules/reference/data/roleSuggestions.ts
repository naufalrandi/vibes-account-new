/* generated from fe-vibes-new-od/js/role-suggestions.js — do not edit by hand.
   Schema preserved verbatim from OD: curated role archetypes + a
   cross-cutting common pool merged in after any template match.
   23 archetypes. */
export interface RoleSuggestionEntry {
  key: string;
  name: string;
  aliases: string[];
  frameworks: string[];
  description: string;
  responsibilities: string[];
  authorities: string[];
}
export const ROLE_SUGGESTIONS: RoleSuggestionEntry[] = [
  {
    "key": "quality-manager",
    "name": "Quality Manager",
    "aliases": [
      "qms manager",
      "quality assurance manager",
      "qa manager",
      "quality management representative",
      "head of quality",
      "quality lead"
    ],
    "frameworks": [
      "ISO 9001"
    ],
    "description": "Owns the quality management system — maintains conformity to ISO 9001, leads the internal audit programme, and drives continual improvement across the organization.",
    "responsibilities": [
      "Establish, maintain and continually improve the quality management system in line with ISO 9001.",
      "Plan and lead the internal audit programme and ensure findings are closed out.",
      "Coordinate root cause analysis and corrective action for nonconformities.",
      "Monitor quality objectives and process performance, and report results to top management.",
      "Manage controlled documents and records for the quality management system.",
      "Prepare for and support external certification and surveillance audits.",
      "Promote customer focus and a quality culture across all departments."
    ],
    "authorities": [
      "Approve quality procedures, work instructions and controlled documents.",
      "Release or hold product or service delivery when a critical nonconformity is found.",
      "Initiate corrective actions and require departments to respond within agreed timeframes.",
      "Approve the annual internal audit plan and assign auditors."
    ]
  },
  {
    "key": "information-security-officer",
    "name": "Information Security Officer",
    "aliases": [
      "ciso",
      "information security manager",
      "isms manager",
      "it security manager",
      "security officer",
      "information security lead",
      "infosec manager"
    ],
    "frameworks": [
      "ISO/IEC 27001"
    ],
    "description": "Runs the information security management system to ISO/IEC 27001 — owns risk assessment, control effectiveness, and incident response.",
    "responsibilities": [
      "Operate, monitor and continually improve the ISO/IEC 27001 information security management system.",
      "Conduct information security risk assessments and maintain the risk treatment plan.",
      "Maintain the Statement of Applicability and verify control effectiveness.",
      "Coordinate detection, response and recovery for information security incidents.",
      "Manage security awareness and training across the organization.",
      "Review access rights and security exceptions for critical systems.",
      "Report on ISMS performance and information security risks to top management."
    ],
    "authorities": [
      "Approve access-control changes and exceptions for critical systems.",
      "Declare and escalate a major information security incident.",
      "Suspend access or isolate a system when a serious threat is identified.",
      "Approve the risk treatment plan and accept residual risks within delegated limits."
    ]
  },
  {
    "key": "data-protection-officer",
    "name": "Data Protection Officer",
    "aliases": [
      "dpo",
      "privacy officer",
      "privacy manager",
      "data privacy officer",
      "pims manager",
      "data protection manager"
    ],
    "frameworks": [
      "ISO/IEC 27701",
      "GDPR"
    ],
    "description": "Oversees the privacy information management system and the lawful, fair processing of personal data in line with ISO/IEC 27701 and applicable privacy law.",
    "responsibilities": [
      "Monitor compliance with privacy law and the privacy information management system.",
      "Maintain records of processing activities and the data inventory.",
      "Conduct and review data protection impact assessments for new or changed processing.",
      "Act as the contact point for data subjects and supervisory authorities.",
      "Manage data subject requests and ensure they are answered within legal timeframes.",
      "Coordinate the response to personal data breaches, including notification decisions.",
      "Deliver privacy awareness and training across the organization."
    ],
    "authorities": [
      "Require changes to processing activities that do not meet privacy requirements.",
      "Approve or reject data protection impact assessments before processing begins.",
      "Decide on personal data breach notification to authorities and data subjects.",
      "Access processing records and systems needed to perform the oversight role."
    ]
  },
  {
    "key": "environmental-manager",
    "name": "Environmental Manager",
    "aliases": [
      "ems manager",
      "environment manager",
      "hse manager",
      "sustainability manager",
      "environmental officer",
      "environmental coordinator"
    ],
    "frameworks": [
      "ISO 14001"
    ],
    "description": "Leads the environmental management system to ISO 14001 — manages aspects and impacts, legal compliance, and environmental performance.",
    "responsibilities": [
      "Maintain and continually improve the environmental management system in line with ISO 14001.",
      "Identify environmental aspects and impacts and keep the register up to date.",
      "Maintain the register of applicable environmental legal and other requirements.",
      "Set, monitor and report environmental objectives and performance indicators.",
      "Coordinate emergency preparedness and response for environmental incidents.",
      "Manage waste, emissions and resource use programmes.",
      "Evaluate environmental compliance and act on any gaps."
    ],
    "authorities": [
      "Approve environmental procedures and operational controls.",
      "Halt an activity that poses an imminent environmental risk.",
      "Initiate corrective actions for environmental nonconformities.",
      "Approve waste and emissions management arrangements."
    ]
  },
  {
    "key": "health-safety-manager",
    "name": "Health & Safety Manager",
    "aliases": [
      "ohs manager",
      "oh&s manager",
      "health and safety manager",
      "safety manager",
      "hse manager",
      "safety officer",
      "ehs manager"
    ],
    "frameworks": [
      "ISO 45001"
    ],
    "description": "Owns the occupational health and safety management system to ISO 45001 — manages hazards, risk controls, and worker participation.",
    "responsibilities": [
      "Maintain and continually improve the OH&S management system in line with ISO 45001.",
      "Lead hazard identification and risk assessment, and verify controls are effective.",
      "Maintain the register of applicable OH&S legal and other requirements.",
      "Investigate incidents and near misses and drive corrective actions.",
      "Coordinate emergency preparedness, drills and response.",
      "Promote worker consultation and participation in OH&S matters.",
      "Monitor and report OH&S performance to top management."
    ],
    "authorities": [
      "Stop any work that presents an imminent danger to health or safety.",
      "Approve safe-work procedures, permits and control measures.",
      "Require corrective actions for OH&S nonconformities.",
      "Approve the provision of personal protective equipment and safety controls."
    ]
  },
  {
    "key": "business-continuity-manager",
    "name": "Business Continuity Manager",
    "aliases": [
      "bcms manager",
      "continuity manager",
      "bcm manager",
      "resilience manager",
      "business continuity officer"
    ],
    "frameworks": [
      "ISO 22301"
    ],
    "description": "Leads the business continuity management system to ISO 22301 — owns business impact analysis, continuity strategies, and exercising.",
    "responsibilities": [
      "Maintain and continually improve the business continuity management system in line with ISO 22301.",
      "Conduct the business impact analysis and continuity risk assessment.",
      "Develop, maintain and test business continuity and recovery plans.",
      "Plan and run continuity exercises and capture lessons learned.",
      "Coordinate the response during a disruptive incident.",
      "Maintain communication and escalation arrangements for disruptions.",
      "Report continuity readiness and performance to top management."
    ],
    "authorities": [
      "Invoke business continuity plans during a disruptive incident.",
      "Approve continuity strategies, recovery time objectives and plans.",
      "Direct the allocation of resources during continuity response.",
      "Require business units to participate in continuity exercises."
    ]
  },
  {
    "key": "compliance-officer",
    "name": "Compliance Officer",
    "aliases": [
      "anti-bribery compliance officer",
      "abms manager",
      "compliance manager",
      "ethics officer",
      "anti-corruption officer",
      "compliance lead"
    ],
    "frameworks": [
      "ISO 37001"
    ],
    "description": "Oversees the anti-bribery and compliance management system to ISO 37001 — owns due diligence, controls, and reporting of compliance concerns.",
    "responsibilities": [
      "Maintain and continually improve the anti-bribery management system in line with ISO 37001.",
      "Assess bribery and compliance risks and define proportionate controls.",
      "Conduct due diligence on transactions, projects and business associates.",
      "Operate confidential reporting (whistleblowing) channels and investigate concerns.",
      "Deliver anti-bribery and compliance training and awareness.",
      "Monitor gifts, hospitality and conflict-of-interest declarations.",
      "Report on compliance performance and concerns to top management and the governing body."
    ],
    "authorities": [
      "Require enhanced due diligence or rejection of high-risk transactions.",
      "Investigate suspected bribery or compliance breaches and access related records.",
      "Approve or decline gifts, hospitality and donations against policy thresholds.",
      "Escalate compliance concerns directly to the governing body."
    ]
  },
  {
    "key": "food-safety-manager",
    "name": "Food Safety Manager",
    "aliases": [
      "fsms manager",
      "haccp manager",
      "food safety team leader",
      "quality and food safety manager",
      "food safety officer"
    ],
    "frameworks": [
      "ISO 22000",
      "HACCP"
    ],
    "description": "Leads the food safety management system to ISO 22000 — owns the HACCP plan, prerequisite programmes, and hazard control.",
    "responsibilities": [
      "Maintain and continually improve the food safety management system in line with ISO 22000.",
      "Lead the HACCP study and keep hazard analysis and control plans current.",
      "Manage prerequisite programmes for hygiene and operational control.",
      "Monitor critical control points and verify corrective actions on deviations.",
      "Manage product traceability, withdrawal and recall arrangements.",
      "Coordinate the food safety team and supplier food-safety assurance.",
      "Report food safety performance to top management."
    ],
    "authorities": [
      "Hold or release product based on food safety status.",
      "Initiate product withdrawal or recall when food safety is at risk.",
      "Approve the HACCP plan, control limits and corrective actions.",
      "Stop a process when a critical control point is out of control."
    ]
  },
  {
    "key": "energy-manager",
    "name": "Energy Manager",
    "aliases": [
      "enms manager",
      "energy management representative",
      "energy officer",
      "energy coordinator"
    ],
    "frameworks": [
      "ISO 50001"
    ],
    "description": "Owns the energy management system to ISO 50001 — manages energy performance, significant energy uses, and improvement projects.",
    "responsibilities": [
      "Maintain and continually improve the energy management system in line with ISO 50001.",
      "Identify significant energy uses and establish the energy baseline.",
      "Define energy performance indicators and monitor energy performance.",
      "Plan and track energy efficiency and improvement projects.",
      "Maintain the register of applicable energy-related legal requirements.",
      "Promote energy awareness and procurement of energy-efficient goods and services.",
      "Report energy performance to top management."
    ],
    "authorities": [
      "Approve energy objectives, baselines and performance indicators.",
      "Prioritize and approve energy improvement projects within delegated limits.",
      "Require operational controls for significant energy uses.",
      "Approve energy-related procurement specifications."
    ]
  },
  {
    "key": "laboratory-manager",
    "name": "Laboratory Manager",
    "aliases": [
      "lab manager",
      "technical manager",
      "quality manager (laboratory)",
      "metrology manager",
      "calibration manager",
      "testing manager"
    ],
    "frameworks": [
      "ISO/IEC 17025"
    ],
    "description": "Manages laboratory operations to ISO/IEC 17025 — owns method validity, measurement traceability, and impartiality of results.",
    "responsibilities": [
      "Maintain laboratory competence and conformity to ISO/IEC 17025.",
      "Ensure validated methods are used and measurement results are traceable.",
      "Manage equipment calibration, maintenance and intermediate checks.",
      "Oversee quality control, proficiency testing and result review.",
      "Safeguard impartiality, confidentiality and valid reporting of results.",
      "Manage complaints and nonconforming testing or calibration work.",
      "Maintain technical records and report performance to top management."
    ],
    "authorities": [
      "Authorize the release of test and calibration reports.",
      "Approve test and calibration methods and their validation.",
      "Suspend a method or equipment that does not meet requirements.",
      "Approve corrective actions for nonconforming work."
    ]
  },
  {
    "key": "internal-auditor",
    "name": "Internal Auditor",
    "aliases": [
      "management system auditor",
      "qms auditor",
      "isms auditor",
      "internal audit specialist",
      "audit team member"
    ],
    "frameworks": [
      "ISO 19011"
    ],
    "description": "Plans and conducts internal audits of the management system, reporting objective findings against requirements.",
    "responsibilities": [
      "Plan and prepare assigned internal audits, including criteria, scope and checklists.",
      "Conduct audits objectively and gather evidence against the audit criteria.",
      "Document findings, nonconformities and improvement opportunities.",
      "Report audit results clearly to auditees and the audit programme manager.",
      "Verify the effectiveness of corrective actions on closed findings.",
      "Maintain auditor competence and independence from the area audited."
    ],
    "authorities": [
      "Access records, areas and personnel needed to perform the audit.",
      "Raise nonconformities and require an auditee response.",
      "Determine the classification of audit findings within the audit scope."
    ]
  },
  {
    "key": "lead-auditor",
    "name": "Lead Auditor",
    "aliases": [
      "audit programme manager",
      "audit team leader",
      "chief auditor",
      "head of internal audit"
    ],
    "frameworks": [
      "ISO 19011"
    ],
    "description": "Manages the internal audit programme and leads audit teams, ensuring audits are planned, competent and value-adding.",
    "responsibilities": [
      "Establish and manage the internal audit programme and schedule.",
      "Select, brief and lead audit teams and allocate audits by competence.",
      "Lead opening and closing meetings and resolve audit-team disagreements.",
      "Consolidate audit results and report programme outcomes to management.",
      "Maintain auditor competence, evaluation and the auditor pool.",
      "Monitor closure and effectiveness of audit findings across the programme."
    ],
    "authorities": [
      "Approve the audit programme, scope and assignment of auditors.",
      "Make final decisions on audit findings and their classification.",
      "Escalate unresolved or systemic findings to top management.",
      "Suspend or reschedule an audit where objectivity or safety is at risk."
    ]
  },
  {
    "key": "document-controller",
    "name": "Document Controller",
    "aliases": [
      "documented information manager",
      "records manager",
      "documentation officer",
      "document control specialist",
      "dms administrator"
    ],
    "frameworks": [
      "ISO 9001",
      "ISO/IEC 27001"
    ],
    "description": "Controls documented information across the management system — versioning, approval routing, distribution, retention and retrieval.",
    "responsibilities": [
      "Maintain the master list and version control of controlled documents.",
      "Route documents for review and approval before issue.",
      "Control distribution, access and withdrawal of obsolete documents.",
      "Manage records retention, archiving and secure disposal schedules.",
      "Protect documented information against loss, misuse and unauthorized change.",
      "Support audits and reviews with timely retrieval of records."
    ],
    "authorities": [
      "Issue, reissue and withdraw controlled documents once approved.",
      "Assign document numbers, version identifiers and access levels.",
      "Reject documents that do not meet format or approval requirements."
    ]
  },
  {
    "key": "management-representative",
    "name": "Management Representative",
    "aliases": [
      "mr",
      "management system representative",
      "qms representative",
      "head of compliance",
      "integrated management system manager",
      "ims manager"
    ],
    "frameworks": [
      "ISO 9001",
      "ISO 14001",
      "ISO 45001",
      "ISO/IEC 27001"
    ],
    "description": "Top-management appointee accountable for ensuring the management system is established, maintained and reported on across the organization.",
    "responsibilities": [
      "Ensure the management system is established, implemented and maintained.",
      "Report on management system performance and improvement needs to top management.",
      "Promote awareness of customer and stakeholder requirements throughout the organization.",
      "Coordinate management reviews and follow up on resulting actions.",
      "Act as the liaison with certification bodies and external parties on the management system.",
      "Oversee that processes deliver their intended outputs."
    ],
    "authorities": [
      "Represent the management system in dealings with external parties.",
      "Direct corrective actions across functions to maintain conformity.",
      "Convene management reviews and require functional reporting.",
      "Escalate systemic risks and resource needs to top management."
    ]
  },
  {
    "key": "top-management",
    "name": "Top Management",
    "aliases": [
      "executive sponsor",
      "managing director",
      "ceo",
      "general manager",
      "director",
      "senior management",
      "accountable executive"
    ],
    "frameworks": [
      "ISO 9001",
      "ISO 14001",
      "ISO 45001",
      "ISO/IEC 27001"
    ],
    "description": "Provides leadership and commitment for the management system, sets policy and objectives, and provides the resources to achieve them.",
    "responsibilities": [
      "Demonstrate leadership and commitment to the management system.",
      "Establish the policy and objectives, aligned with the strategic direction.",
      "Ensure the management system requirements are integrated into business processes.",
      "Provide the resources needed for the management system.",
      "Assign roles, responsibilities and authorities and communicate them.",
      "Conduct management reviews and act on their outputs.",
      "Promote improvement and a culture of conformity."
    ],
    "authorities": [
      "Approve the management system policy, objectives and scope.",
      "Allocate resources and approve the management system budget.",
      "Appoint roles and delegate responsibilities and authorities.",
      "Accept strategic risks and approve major management system decisions."
    ]
  },
  {
    "key": "hr-competence-manager",
    "name": "HR & Competence Manager",
    "aliases": [
      "hr manager",
      "human resources manager",
      "people manager",
      "competence manager",
      "learning and development manager",
      "training manager"
    ],
    "frameworks": [
      "ISO 9001",
      "ISO 10015"
    ],
    "description": "Defines role competence profiles, runs competence assessments, and plans training to close capability gaps.",
    "responsibilities": [
      "Define role competence profiles and assessment criteria across the organization.",
      "Run periodic competence assessments and maintain the records.",
      "Plan, schedule and track training to close identified competence gaps.",
      "Evaluate the effectiveness of training and development actions.",
      "Maintain personnel records, qualifications and evidence of competence.",
      "Support recruitment and onboarding against role requirements.",
      "Promote awareness of policies, objectives and individual contributions."
    ],
    "authorities": [
      "Approve role competence profiles and assessment criteria.",
      "Approve training plans and development budgets within delegated limits.",
      "Confirm or withhold competence sign-off for a role.",
      "Require reassessment when role requirements or performance change."
    ]
  },
  {
    "key": "training-coordinator",
    "name": "Training Coordinator",
    "aliases": [
      "learning coordinator",
      "training officer",
      "l&d coordinator",
      "training administrator"
    ],
    "frameworks": [
      "ISO 10015"
    ],
    "description": "Organizes and records training and awareness activities and supports closure of competence gaps.",
    "responsibilities": [
      "Maintain the training calendar and coordinate scheduled sessions.",
      "Arrange internal and external trainers, venues and materials.",
      "Record attendance, results and certificates of completion.",
      "Track outstanding training against competence gaps and due dates.",
      "Gather feedback and support evaluation of training effectiveness.",
      "Keep training records and qualification evidence up to date."
    ],
    "authorities": [
      "Schedule and reschedule training sessions within the approved plan.",
      "Confirm completion and update training records.",
      "Escalate overdue mandatory training to managers."
    ]
  },
  {
    "key": "risk-manager",
    "name": "Risk Manager",
    "aliases": [
      "risk officer",
      "erm manager",
      "enterprise risk manager",
      "risk and compliance manager",
      "risk coordinator"
    ],
    "frameworks": [
      "ISO 31000"
    ],
    "description": "Owns the risk management framework — coordinates risk identification, assessment, treatment and monitoring across the organization.",
    "responsibilities": [
      "Maintain the risk management framework, methodology and risk appetite.",
      "Coordinate risk identification and assessment across functions.",
      "Maintain the risk register and track treatment actions to closure.",
      "Monitor key risk indicators and report the risk profile to management.",
      "Facilitate risk reviews for projects, changes and new initiatives.",
      "Promote risk awareness and consistent risk practices."
    ],
    "authorities": [
      "Approve the risk assessment methodology and risk criteria.",
      "Require risk treatment plans for risks above tolerance.",
      "Escalate risks exceeding appetite to top management.",
      "Access information needed to assess and monitor risk."
    ]
  },
  {
    "key": "operations-manager",
    "name": "Operations Manager",
    "aliases": [
      "production manager",
      "plant manager",
      "operations lead",
      "manufacturing manager",
      "service delivery manager",
      "head of operations"
    ],
    "frameworks": [
      "ISO 9001"
    ],
    "description": "Manages day-to-day operations to meet output, quality and delivery requirements while controlling operational risk.",
    "responsibilities": [
      "Plan and control operations to meet output, quality and delivery targets.",
      "Ensure operational processes follow approved procedures and controls.",
      "Manage operational resources, capacity and scheduling.",
      "Monitor process performance and act on deviations.",
      "Coordinate with quality, maintenance and supply functions.",
      "Drive operational improvement and waste reduction.",
      "Ensure operational records are accurate and complete."
    ],
    "authorities": [
      "Approve production or service schedules and resource allocation.",
      "Stop operations when quality, safety or compliance is at risk.",
      "Authorize operational changes within delegated limits.",
      "Approve operational expenditure up to defined thresholds."
    ]
  },
  {
    "key": "maintenance-manager",
    "name": "Maintenance Manager",
    "aliases": [
      "maintenance lead",
      "facilities manager",
      "engineering manager",
      "asset manager",
      "maintenance supervisor"
    ],
    "frameworks": [
      "ISO 9001",
      "ISO 55001"
    ],
    "description": "Ensures infrastructure and equipment are available, reliable and safe through planned and corrective maintenance.",
    "responsibilities": [
      "Plan and manage preventive and corrective maintenance programmes.",
      "Maintain the asset register and equipment maintenance history.",
      "Manage calibration and verification of monitoring and measuring equipment.",
      "Monitor equipment reliability and availability and act on failures.",
      "Manage spare parts, contractors and maintenance budgets.",
      "Ensure maintenance work meets safety and quality requirements."
    ],
    "authorities": [
      "Approve maintenance plans, schedules and shutdowns.",
      "Take equipment out of service when it is unsafe or out of tolerance.",
      "Authorize maintenance spend and contractor work within limits.",
      "Approve return of equipment to service after maintenance."
    ]
  },
  {
    "key": "procurement-manager",
    "name": "Procurement & Supplier Manager",
    "aliases": [
      "purchasing manager",
      "procurement officer",
      "supply chain manager",
      "vendor manager",
      "supplier quality manager",
      "sourcing manager"
    ],
    "frameworks": [
      "ISO 9001"
    ],
    "description": "Manages procurement of externally provided products and services and assures supplier performance against requirements.",
    "responsibilities": [
      "Manage procurement of externally provided products and services to defined requirements.",
      "Evaluate, select and approve suppliers and maintain the approved supplier list.",
      "Monitor supplier performance and conduct supplier reviews or audits.",
      "Verify that purchased products and services meet specifications.",
      "Manage supplier nonconformities and corrective actions.",
      "Maintain procurement and supplier records."
    ],
    "authorities": [
      "Approve purchase orders and contracts within delegated limits.",
      "Add suppliers to, or remove them from, the approved supplier list.",
      "Reject nonconforming deliveries and require supplier corrective action.",
      "Approve supplier evaluation criteria and ratings."
    ]
  },
  {
    "key": "improvement-lead",
    "name": "Continual Improvement Lead",
    "aliases": [
      "ci manager",
      "capa coordinator",
      "continuous improvement manager",
      "process improvement lead",
      "lean manager",
      "quality engineer"
    ],
    "frameworks": [
      "ISO 9001"
    ],
    "description": "Drives the corrective action and continual improvement process, coordinating problem-solving and tracking improvement outcomes.",
    "responsibilities": [
      "Coordinate the corrective action (CAPA) process from logging to closure.",
      "Facilitate root cause analysis and problem-solving for nonconformities.",
      "Track improvement actions, owners and due dates to completion.",
      "Verify and report the effectiveness of corrective and improvement actions.",
      "Analyze trends from audits, incidents, complaints and performance data.",
      "Promote improvement methods and a continual improvement culture."
    ],
    "authorities": [
      "Raise corrective actions and assign owners and timeframes.",
      "Require root cause analysis before closing significant nonconformities.",
      "Verify and approve closure of corrective and improvement actions.",
      "Escalate overdue or recurring issues to management."
    ]
  },
  {
    "key": "incident-response-coordinator",
    "name": "Incident Response Coordinator",
    "aliases": [
      "emergency response coordinator",
      "crisis manager",
      "incident manager",
      "soc lead",
      "response team leader"
    ],
    "frameworks": [
      "ISO/IEC 27035",
      "ISO 22301"
    ],
    "description": "Coordinates the organization’s response to incidents and emergencies — from detection and containment through recovery and lessons learned.",
    "responsibilities": [
      "Maintain incident response and emergency plans and contact arrangements.",
      "Coordinate detection, triage, containment and recovery during incidents.",
      "Lead the response team and manage communication during an incident.",
      "Document the incident timeline, decisions and actions taken.",
      "Run post-incident reviews and capture lessons learned.",
      "Maintain readiness through drills, exercises and training."
    ],
    "authorities": [
      "Declare an incident or emergency and activate response plans.",
      "Direct response resources and actions during an incident.",
      "Escalate to management, authorities and external parties as required.",
      "Authorize containment measures, including stopping affected activities."
    ]
  }
];
export const ROLE_SUGGEST_COMMON: { responsibilities: string[]; authorities: string[] } = {
  "responsibilities": [
    "Comply with the organization’s management system policies and procedures.",
    "Report incidents, nonconformities and improvement opportunities through the defined channels.",
    "Maintain accurate and complete records within the area of responsibility.",
    "Participate in audits, management reviews and competence assessments as required.",
    "Support corrective actions arising from audits and incidents within the area of responsibility.",
    "Keep up to date with the competence and training required for the role."
  ],
  "authorities": [
    "Stop an activity that poses an immediate safety, quality, security or compliance risk.",
    "Request the records and information needed to perform assigned duties.",
    "Escalate risks and issues beyond the role’s authority to the appropriate manager."
  ]
};
