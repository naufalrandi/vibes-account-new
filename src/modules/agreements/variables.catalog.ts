/**
 * The partnership-agreement variable catalog — 6 groups / 28 variables, served at
 * GET /v1/partnership-agreements/variables and used for `{{token}}` substitution.
 * Mirrors the legacy VARGROUPS/VARMAP reference (decision R8: substitution is a
 * pure FE/edge concern; the backend just publishes the catalog + stores values).
 */
export interface AgreementVariable {
  key: string;
  group: string;
  description: string;
  example: string;
}

export const AGREEMENT_VARIABLES: AgreementVariable[] = [
  // Partner Information
  { key: "partner_name", group: "Partner Information", description: "Partner organization name", example: "Nusantara Cloud" },
  { key: "partner_code", group: "Partner Information", description: "Partner code", example: "PRT-1001" },
  { key: "partner_email", group: "Partner Information", description: "Partner contact email", example: "partners@nusantara.cloud" },
  { key: "partner_phone", group: "Partner Information", description: "Partner contact phone", example: "+62 21 5555 1200" },
  { key: "partner_address", group: "Partner Information", description: "Partner registered address", example: "Jl. Sudirman Kav. 52, Jakarta" },
  { key: "partner_country", group: "Partner Information", description: "Partner country (ISO 3166-1 alpha-2)", example: "ID" },
  // Agreement Information
  { key: "agreement_number", group: "Agreement Information", description: "Generated agreement number", example: "AGR-2026-0001" },
  { key: "agreement_date", group: "Agreement Information", description: "Date the agreement was issued", example: "2026-04-05" },
  { key: "effective_date", group: "Agreement Information", description: "Effective date", example: "2026-04-01" },
  { key: "expiration_date", group: "Agreement Information", description: "Expiration date", example: "2028-03-31" },
  { key: "agreement_duration_months", group: "Agreement Information", description: "Duration in months", example: "24" },
  // Commercial Information
  { key: "revenue_share_percentage", group: "Commercial Information", description: "Revenue share percentage", example: "20" },
  { key: "partner_discount_percentage", group: "Commercial Information", description: "Partner discount percentage", example: "15" },
  { key: "minimum_sales_target", group: "Commercial Information", description: "Minimum sales target", example: "500000000" },
  { key: "minimum_subscription_quantity", group: "Commercial Information", description: "Minimum subscription quantity", example: "10" },
  { key: "minimum_revenue_commitment", group: "Commercial Information", description: "Minimum revenue commitment", example: "1000000000" },
  { key: "payment_due_days", group: "Commercial Information", description: "Payment due (days)", example: "30" },
  { key: "currency", group: "Commercial Information", description: "Settlement currency", example: "IDR" },
  // Service Provider Information
  { key: "service_provider_name", group: "Service Provider Information", description: "Service provider name", example: "AXIA" },
  { key: "service_provider_address", group: "Service Provider Information", description: "Service provider address", example: "1 Marina Blvd, Singapore" },
  { key: "service_provider_email", group: "Service Provider Information", description: "Service provider email", example: "ops@axia.io" },
  { key: "service_provider_signatory_name", group: "Service Provider Information", description: "SP signatory name", example: "James Tan" },
  { key: "service_provider_signatory_title", group: "Service Provider Information", description: "SP signatory title", example: "Chief Executive Officer" },
  // Partner Signature Information
  { key: "partner_signatory_name", group: "Partner Signature Information", description: "Partner signatory name", example: "Andi Wijaya" },
  { key: "partner_signatory_title", group: "Partner Signature Information", description: "Partner signatory title", example: "Managing Director" },
  // Legal Information
  { key: "governing_law", group: "Legal Information", description: "Governing law", example: "Republic of Indonesia" },
  { key: "jurisdiction", group: "Legal Information", description: "Jurisdiction", example: "Jakarta" },
  { key: "termination_notice_days", group: "Legal Information", description: "Termination notice (days)", example: "60" },
];
