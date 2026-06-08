/**
 * The agreement variable catalog used by the document editor's variable panel and
 * by generation token substitution. Each variable is referenced in template
 * blocks as `{{key}}` (snake_case). Mirrors the AXIA VARGROUPS exactly.
 */
export interface AgreementVariable {
  key: string;
  group: string;
  description: string;
  example: string;
}

export const AGREEMENT_VARIABLES: AgreementVariable[] = [
  // Partner Information
  { key: "partner_name", group: "Partner Information", description: "Legal name of the partner organization", example: "ABC Consulting" },
  { key: "partner_code", group: "Partner Information", description: "Auto-generated partner code", example: "PRT-1001" },
  { key: "partner_email", group: "Partner Information", description: "Primary partner contact email", example: "partners@abc.co" },
  { key: "partner_phone", group: "Partner Information", description: "Partner contact phone number", example: "+62 21 5555 1200" },
  { key: "partner_address", group: "Partner Information", description: "Registered partner address", example: "Jl. Sudirman 52, Jakarta" },
  { key: "partner_country", group: "Partner Information", description: "Partner jurisdiction country", example: "Indonesia" },
  // Agreement Information
  { key: "agreement_number", group: "Agreement Information", description: "Generated agreement number", example: "AGR-2026-0001" },
  { key: "agreement_date", group: "Agreement Information", description: "Date the agreement is issued", example: "1 Jul 2026" },
  { key: "effective_date", group: "Agreement Information", description: "Date the agreement takes effect", example: "1 Jul 2026" },
  { key: "expiration_date", group: "Agreement Information", description: "Date the agreement expires", example: "30 Jun 2028" },
  { key: "agreement_duration_months", group: "Agreement Information", description: "Agreement duration in months", example: "12" },
  // Commercial Information
  { key: "revenue_share_percentage", group: "Commercial Information", description: "Revenue share granted to the partner", example: "20%" },
  { key: "partner_discount_percentage", group: "Commercial Information", description: "Partner discount on list price", example: "15%" },
  { key: "minimum_sales_target", group: "Commercial Information", description: "Minimum sales target for the term", example: "IDR 500,000,000" },
  { key: "minimum_subscription_quantity", group: "Commercial Information", description: "Minimum number of subscriptions", example: "25" },
  { key: "minimum_revenue_commitment", group: "Commercial Information", description: "Minimum revenue commitment", example: "IDR 250,000,000" },
  { key: "payment_due_days", group: "Commercial Information", description: "Payment terms in days", example: "30" },
  { key: "currency", group: "Commercial Information", description: "Contract currency", example: "IDR" },
  // Service Provider Information
  { key: "service_provider_name", group: "Service Provider Information", description: "Service Provider legal name", example: "AXIA" },
  { key: "service_provider_address", group: "Service Provider Information", description: "Service Provider registered address", example: "Jakarta, Indonesia" },
  { key: "service_provider_email", group: "Service Provider Information", description: "Service Provider contact email", example: "legal@axia.io" },
  { key: "service_provider_signatory_name", group: "Service Provider Information", description: "SP authorized signatory", example: "AXIA Platform Owner" },
  { key: "service_provider_signatory_title", group: "Service Provider Information", description: "SP signatory title", example: "Chief Executive Officer" },
  // Partner Signature Information
  { key: "partner_signatory_name", group: "Partner Signature Information", description: "Partner authorized signatory", example: "Andi Wijaya" },
  { key: "partner_signatory_title", group: "Partner Signature Information", description: "Partner signatory title", example: "Managing Director" },
  // Legal Information
  { key: "governing_law", group: "Legal Information", description: "Governing law of the agreement", example: "the Republic of Indonesia" },
  { key: "jurisdiction", group: "Legal Information", description: "Legal jurisdiction", example: "Jakarta" },
  { key: "termination_notice_days", group: "Legal Information", description: "Termination notice period in days", example: "60" },
];

/** Camel-case `vars` defaults stored on a partner agreement instance. */
export interface AgreementVarDefaults {
  effectiveDate: string;
  durationMonths: string;
  revenueShare: string;
  discount: string;
  currency: string;
  paymentDueDays: string;
  governingLaw: string;
  jurisdiction: string;
  terminationNoticeDays: string;
  spSignatory: string;
  partnerSignatory: string;
}

export function defaultAgreementVars(): AgreementVarDefaults {
  return {
    effectiveDate: "2026-07-01",
    durationMonths: "24",
    revenueShare: "20",
    discount: "15",
    currency: "USD",
    paymentDueDays: "30",
    governingLaw: "Republic of Indonesia",
    jurisdiction: "Jakarta",
    terminationNoticeDays: "60",
    spSignatory: "AXIA Platform Owner",
    partnerSignatory: "",
  };
}
