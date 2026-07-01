# AXIA v1 API Surface — Frozen Inventory (Phase 12)

Generated from `src/app.ts` mounts + `src/modules/*/*.routes.ts` on 2026-07-01.
182 endpoints across 37 mounts. Every business mutation is tenant-scoped and audited
(`writeAudit`); action gates shown where `requireAction` applies. Auth endpoints are
rate-limited; all others sit behind `authenticate` + `tenantScope`. Reference endpoints
are read-only + cacheable.

```
POST   /v1/auth/login
POST   /v1/auth/refresh
POST   /v1/auth/logout
POST   /v1/auth/activate
POST   /v1/auth/password/forgot
POST   /v1/auth/password/reset
GET    /v1/users                                        ACTIONS.USER_READ
POST   /v1/users                                        ACTIONS.USER_CREATE
PATCH  /v1/users/:id/status                             ACTIONS.USER_SUSPEND
POST   /v1/users/:id/resend-activation                  ACTIONS.USER_UPDATE
DELETE /v1/users/:id                                    ACTIONS.USER_DELETE
POST   /v1/users/:id/roles                              ACTIONS.ROLE_ASSIGN
DELETE /v1/users/:id/roles/:roleId                      ACTIONS.ROLE_ASSIGN
GET    /v1/organizations                                ACTIONS.ORG_READ
GET    /v1/organizations/:id                            ACTIONS.ORG_READ
POST   /v1/organizations                                ACTIONS.ORG_CREATE
POST   /v1/organizations/:id/activate                   ACTIONS.ORG_ACTIVATE
POST   /v1/organizations/:id/suspend                    ACTIONS.ORG_SUSPEND
GET    /v1/org-settings                                 ACTIONS.ORG_READ
PATCH  /v1/org-settings                                 ACTIONS.ORG_UPDATE
GET    /v1/registration-requests                        ACTIONS.REGISTRATION_DECIDE
POST   /v1/registration-requests                        ACTIONS.REGISTRATION_SUBMIT
POST   /v1/registration-requests/:id/approve            ACTIONS.REGISTRATION_DECIDE
POST   /v1/registration-requests/:id/reject             ACTIONS.REGISTRATION_DECIDE
GET    /v1/audit                                        ACTIONS.AUDIT_READ
GET    /v1/audit/login-history/:id                      ACTIONS.AUDIT_READ
GET    /v1/roles                                        ACTIONS.ROLE_READ
GET    /v1/roles/:id/grants                             ACTIONS.ROLE_READ
PUT    /v1/roles/:id/grants                             ACTIONS.ROLE_GRANT
GET    /v1/menu
GET    /v1/menu/all                                     ACTIONS.MENU_READ
POST   /v1/menu                                         ACTIONS.MENU_MANAGE
GET    /v1/dashboard/stats
GET    /v1/dashboard/recent
GET    /v1/framework-types                              ACTIONS.FRAMEWORK_TYPE_READ
POST   /v1/framework-types                              ACTIONS.FRAMEWORK_TYPE_CREATE
PUT    /v1/framework-types/:id                          ACTIONS.FRAMEWORK_TYPE_UPDATE
DELETE /v1/framework-types/:id                          ACTIONS.FRAMEWORK_TYPE_DELETE
GET    /v1/framework-families                           ACTIONS.FRAMEWORK_FAMILY_READ
POST   /v1/framework-families                           ACTIONS.FRAMEWORK_FAMILY_CREATE
PUT    /v1/framework-families/:id                       ACTIONS.FRAMEWORK_FAMILY_UPDATE
DELETE /v1/framework-families/:id                       ACTIONS.FRAMEWORK_FAMILY_DELETE
GET    /v1/frameworks                                   ACTIONS.FRAMEWORK_READ
GET    /v1/frameworks/:id                               ACTIONS.FRAMEWORK_READ
POST   /v1/frameworks                                   ACTIONS.FRAMEWORK_CREATE
PUT    /v1/frameworks/:id                               ACTIONS.FRAMEWORK_UPDATE
DELETE /v1/frameworks/:id                               ACTIONS.FRAMEWORK_DELETE
GET    /v1/framework-groups                             ACTIONS.FRAMEWORK_READ
/v1/requirements  (router requirementRoutes — special)
/v1/criteria  (router criteriaRoutes — special)
/v1/elements  (router elementRoutes — special)
/v1/framework-xref  (router xrefRoutes — special)
GET    /v1/assessment/elements/:id                      ACTIONS.ASSESSMENT_READ
POST   /v1/assessment/questions                         ACTIONS.ASSESSMENT_MANAGE
PUT    /v1/assessment/questions/:id                     ACTIONS.ASSESSMENT_MANAGE
DELETE /v1/assessment/questions/:id                     ACTIONS.ASSESSMENT_MANAGE
POST   /v1/assessment/responses                         ACTIONS.ASSESSMENT_MANAGE
PUT    /v1/assessment/responses/:id                     ACTIONS.ASSESSMENT_MANAGE
PUT    /v1/assessment/responses/:id/criterion           ACTIONS.ASSESSMENT_MANAGE
DELETE /v1/assessment/responses/:id                     ACTIONS.ASSESSMENT_MANAGE
GET    /v1/assessment/response-criteria                 ACTIONS.ASSESSMENT_READ
GET    /v1/assessment/criterion-options                 ACTIONS.ASSESSMENT_READ
GET    /v1/framework-catalog                            ACTIONS.FRAMEWORK_CATALOG_READ
POST   /v1/framework-catalog/:frameworkId/subscribe     ACTIONS.FRAMEWORK_CATALOG_SUBSCRIBE
GET    /v1/my-frameworks                                ACTIONS.MY_FRAMEWORK_READ
DELETE /v1/my-frameworks/:subscriptionId                ACTIONS.MY_FRAMEWORK_DELETE
GET    /v1/profiles                                     ACTIONS.PROFILE_READ
POST   /v1/profiles                                     ACTIONS.PROFILE_CREATE
PUT    /v1/profiles/:id                                 ACTIONS.PROFILE_UPDATE
DELETE /v1/profiles/:id                                 ACTIONS.PROFILE_DELETE
GET    /v1/accounts                                     ACTIONS.ACCOUNT_READ
POST   /v1/accounts                                     ACTIONS.ACCOUNT_CREATE
PUT    /v1/accounts/:id                                 ACTIONS.ACCOUNT_UPDATE
DELETE /v1/accounts/:id                                 ACTIONS.ACCOUNT_DELETE
GET    /v1/signatories                                  ACTIONS.SIGNATORY_READ
POST   /v1/signatories                                  ACTIONS.SIGNATORY_CREATE
PUT    /v1/signatories/:id                              ACTIONS.SIGNATORY_UPDATE
POST   /v1/signatories/:id/toggle                       ACTIONS.SIGNATORY_UPDATE
DELETE /v1/signatories/:id                              ACTIONS.SIGNATORY_DELETE
GET    /v1/partners                                     ACTIONS.PARTNER_READ
POST   /v1/partners                                     ACTIONS.PARTNER_CREATE
GET    /v1/partners/:id                                 ACTIONS.PARTNER_READ
PUT    /v1/partners/:id                                 ACTIONS.PARTNER_UPDATE
POST   /v1/partners/:id/activate                        ACTIONS.PARTNER_UPDATE
POST   /v1/partners/:id/suspend                         ACTIONS.PARTNER_UPDATE
POST   /v1/partners/:id/resume                          ACTIONS.PARTNER_UPDATE
POST   /v1/partners/:id/terminate                       ACTIONS.PARTNER_UPDATE
GET    /v1/partners/:id/agreement                       ACTIONS.PARTNER_READ
POST   /v1/partners/:id/agreement/generate              ACTIONS.PARTNER_UPDATE
POST   /v1/partners/:id/agreement/regenerate            ACTIONS.PARTNER_UPDATE
POST   /v1/partners/:id/agreement/resend                ACTIONS.PARTNER_UPDATE
POST   /v1/partners/:id/agreement/approve               ACTIONS.PARTNER_UPDATE
GET    /v1/partnership-agreements/variables             ACTIONS.AGREEMENT_READ
GET    /v1/partnership-agreements                       ACTIONS.AGREEMENT_READ
GET    /v1/partnership-agreements/:id                   ACTIONS.AGREEMENT_READ
POST   /v1/partnership-agreements                       ACTIONS.AGREEMENT_CREATE
PUT    /v1/partnership-agreements/:id                   ACTIONS.AGREEMENT_UPDATE
POST   /v1/partnership-agreements/:id/duplicate         ACTIONS.AGREEMENT_CREATE
DELETE /v1/partnership-agreements/:id                   ACTIONS.AGREEMENT_DELETE
GET    /v1/tenants                                      ACTIONS.TENANT_READ
POST   /v1/tenants                                      ACTIONS.TENANT_CREATE
GET    /v1/tenants/:id                                  ACTIONS.TENANT_READ
POST   /v1/tenants/:id/send-activation                  ACTIONS.TENANT_UPDATE
POST   /v1/tenants/:id/resend-activation                ACTIONS.TENANT_UPDATE
POST   /v1/tenants/:id/activate                         ACTIONS.TENANT_UPDATE
POST   /v1/tenants/:id/suspend                          ACTIONS.TENANT_UPDATE
POST   /v1/tenants/:id/resume                           ACTIONS.TENANT_UPDATE
POST   /v1/tenants/:id/deactivate                       ACTIONS.TENANT_UPDATE
POST   /v1/tenants/:id/reactivate                       ACTIONS.TENANT_UPDATE
GET    /v1/sites                                        ACTIONS.SITE_READ
POST   /v1/sites                                        ACTIONS.SITE_CREATE
GET    /v1/sites/:id                                    ACTIONS.SITE_READ
PUT    /v1/sites/:id                                    ACTIONS.SITE_UPDATE
DELETE /v1/sites/:id                                    ACTIONS.SITE_DELETE
GET    /v1/site-requests                                ACTIONS.SITE_REQUEST_READ
POST   /v1/site-requests                                ACTIONS.SITE_REQUEST_CREATE
GET    /v1/site-requests/:id                            ACTIONS.SITE_REQUEST_READ
POST   /v1/site-requests/:id/review                     ACTIONS.SITE_REQUEST_DECIDE
POST   /v1/site-requests/:id/approve                    ACTIONS.SITE_REQUEST_DECIDE
POST   /v1/site-requests/:id/reject                     ACTIONS.SITE_REQUEST_DECIDE
POST   /v1/site-requests/:id/provision                  ACTIONS.SITE_REQUEST_DECIDE
GET    /v1/framework-assignments                        ACTIONS.FRAMEWORK_ASSIGNMENT_READ
POST   /v1/framework-assignments                        ACTIONS.FRAMEWORK_ASSIGNMENT_CREATE
PUT    /v1/framework-assignments/:id                    ACTIONS.FRAMEWORK_ASSIGNMENT_UPDATE
DELETE /v1/framework-assignments/:id                    ACTIONS.FRAMEWORK_ASSIGNMENT_DELETE
GET    /v1/billing/plans                                ACTIONS.BILLING_READ
POST   /v1/billing/plans                                ACTIONS.BILLING_MANAGE
PUT    /v1/billing/plans/:id                            ACTIONS.BILLING_MANAGE
GET    /v1/billing/dashboard                            ACTIONS.BILLING_READ
GET    /v1/billing/subscriptions                        ACTIONS.BILLING_READ
GET    /v1/billing/invoices                             ACTIONS.BILLING_READ
POST   /v1/billing/invoices/:id/pay                     ACTIONS.BILLING_MANAGE
GET    /v1/billing/payments                             ACTIONS.BILLING_READ
GET    /v1/billing/receipts                             ACTIONS.BILLING_READ
GET    /v1/billing/revenue-share                        ACTIONS.BILLING_READ
GET    /v1/billing/payouts                              ACTIONS.BILLING_READ
POST   /v1/billing/payouts/:id/mark-paid                ACTIONS.BILLING_MANAGE
GET    /v1/tickets                                      ACTIONS.TICKET_READ
POST   /v1/tickets                                      ACTIONS.TICKET_CREATE
GET    /v1/tickets/:id                                  ACTIONS.TICKET_READ
POST   /v1/tickets/:id/reply                            ACTIONS.TICKET_REPLY
POST   /v1/tickets/:id/status                           ACTIONS.TICKET_MANAGE
POST   /v1/tickets/:id/assign                           ACTIONS.TICKET_MANAGE
GET    /v1/assessments                                  ACTIONS.ASSESSMENT_RUN_READ
POST   /v1/assessments                                  ACTIONS.ASSESSMENT_RUN_MANAGE
GET    /v1/assessments/:id                              ACTIONS.ASSESSMENT_RUN_READ
POST   /v1/assessments/:id/answers                      ACTIONS.ASSESSMENT_RUN_MANAGE
POST   /v1/assessments/:id/finalize                     ACTIONS.ASSESSMENT_RUN_MANAGE
GET    /v1/assessments/:id/results                      ACTIONS.ASSESSMENT_RUN_READ
GET    /v1/assessments/:id/gaps                         ACTIONS.ASSESSMENT_RUN_READ
POST   /v1/assessments/:id/reassess                     ACTIONS.ASSESSMENT_RUN_MANAGE
GET    /v1/implementation/:module                       ACTIONS.MS_READ
POST   /v1/implementation/:module                       ACTIONS.MS_MANAGE
PUT    /v1/implementation/:module/:id                   ACTIONS.MS_MANAGE
DELETE /v1/implementation/:module/:id                   ACTIONS.MS_MANAGE
GET    /v1/lims/workflow-config                         ACTIONS.LIMS_READ
GET    /v1/lims/workflow-preview                        ACTIONS.LIMS_READ
GET    /v1/lims/testing-services                        ACTIONS.LIMS_READ
POST   /v1/lims/testing-services                        ACTIONS.LIMS_MANAGE
GET    /v1/lims/testing-services/:id                    ACTIONS.LIMS_READ
PUT    /v1/lims/testing-services/:id                    ACTIONS.LIMS_MANAGE
DELETE /v1/lims/testing-services/:id                    ACTIONS.LIMS_MANAGE
GET    /v1/kb-articles/categories                       ACTIONS.KB_READ
GET    /v1/kb-articles                                  ACTIONS.KB_READ
POST   /v1/kb-articles                                  ACTIONS.KB_MANAGE
GET    /v1/kb-articles/:id                              ACTIONS.KB_READ
PUT    /v1/kb-articles/:id                              ACTIONS.KB_MANAGE
DELETE /v1/kb-articles/:id                              ACTIONS.KB_MANAGE
POST   /v1/kb-articles/:id/publish                      ACTIONS.KB_MANAGE
POST   /v1/kb-articles/:id/archive                      ACTIONS.KB_MANAGE
POST   /v1/kb-articles/:id/vote                         ACTIONS.KB_READ
GET    /v1/notifications
POST   /v1/notifications/read
GET    /v1/reference/isic
GET    /v1/reference/isic/:code/notes
GET    /v1/reference/nace
GET    /v1/reference/nace/:code/notes
GET    /v1/reference/kbli
GET    /v1/reference/kbli/:code/notes
GET    /v1/reference/iscedf
GET    /v1/reference/exam-bank
GET    /v1/reference/role-suggestions
```
