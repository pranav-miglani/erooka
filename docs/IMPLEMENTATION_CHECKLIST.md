# Erooka - Implementation Checklist

## Project Overview
**Erooka** - Solar Work Order Mapping System  
**Architecture**: Serverless (AWS Lambda + DynamoDB)  
**Scale**: 7000 plants max, ~35k alerts/day, 30 concurrent users  
**Testing**: TDD with Cucumber, >90% coverage target

---

## ✅ Completed Features

### Phase 0: Foundation
- [x] Project structure created
- [x] DynamoDB schema designed
- [x] Testing framework setup
- [ ] Terraform infrastructure code

### Phase 1: Authentication & Authorization
- [x] Account entity (DynamoDB) - Domain model created
- [x] AccountRepository interface and DynamoDB implementation
- [x] AuthService with login, password hashing, session management
- [x] Login API handler (POST /api/login) - Lambda function
- [x] GET /api/me endpoint handler - Lambda function
- [x] POST /api/accounts - Create account (SUPERADMIN/DEVELOPER only)
- [x] GET /api/accounts - List accounts (SUPERADMIN only)
- [x] AccountService for account management
- [x] Session management (HTTP-only cookies, base64 encoding)
- [x] RBAC system (shared/rbac)
- [ ] Middleware for route protection (API Gateway authorizer)
- [x] Unit tests for AuthService
- [x] Cucumber feature file for authentication
- [ ] Integration tests with DynamoDB Local
- [ ] **Tests**: Complete test coverage

### Phase 2: Organizations
- [x] Organization entity (DynamoDB)
- [x] GET /api/orgs (list with RBAC filtering)
- [x] POST /api/orgs (create - SUPERADMIN only)
- [x] GET /api/orgs/[id] (get single org)
- [x] PUT /api/orgs/[id] (update - SUPERADMIN only)
- [x] DELETE /api/orgs/[id] (delete - SUPERADMIN only)
- [ ] GET /api/orgs/[id]/plants (get org plants)
- [ ] GET /api/orgs/[id]/production (production metrics)
- [x] **Tests**: Unit tests for OrganizationService
- [ ] **Tests**: Integration + Cucumber features

### Phase 3: Vendors
- [x] Vendor entity (DynamoDB)
- [x] VendorRepository (DynamoDB implementation)
- [ ] VendorService
- [ ] GET /api/vendors (list with RBAC filtering)
- [ ] POST /api/vendors (create - SUPERADMIN only)
- [ ] GET /api/vendors/[id] (get single vendor)
- [ ] PUT /api/vendors/[id] (update - SUPERADMIN only)
- [ ] DELETE /api/vendors/[id] (delete - SUPERADMIN only)
- [ ] POST /api/vendors/[id]/sync-plants (sync plants)
- [ ] POST /api/vendors/[id]/sync-alerts (sync alerts)
- [ ] GET /api/vendors/[id]/production (production metrics)
- [ ] GET /api/vendors/sync-status (sync status dashboard)
- [ ] Vendor adapter system (Strategy + Factory pattern)
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 4: Plants
- [ ] Plant entity (DynamoDB)
- [ ] GET /api/plants (list with RBAC filtering)
- [ ] GET /api/plants/[id] (get single plant)
- [ ] PATCH /api/plants/[id] (update - SUPERADMIN only)
- [ ] GET /api/plants/[id]/production (production metrics)
- [ ] GET /api/plants/[id]/telemetry (telemetry data)
- [ ] GET /api/plants/unassigned (unassigned plants)
- [ ] Plant sync service
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 5: Alerts
- [ ] Alert entity (DynamoDB with TTL)
- [ ] GET /api/alerts (list with RBAC filtering, pagination)
- [ ] GET /api/alerts?plantId=X (filter by plant)
- [ ] PATCH /api/alerts/[id] (update status - SUPERADMIN only)
- [ ] Alert sync service
- [ ] Alert deduplication logic
- [ ] Grid downtime calculation
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 6: Work Orders
- [ ] Work Order entity (DynamoDB)
- [ ] Work Order Plant mappings table (work-order-plants, DynamoDB)
- [ ] GET /api/workorders (list with RBAC filtering)
- [ ] POST /api/workorders (create - SUPERADMIN only)
- [ ] GET /api/workorders/[id] (get single work order)
- [ ] PATCH /api/workorders/[id] (update - SUPERADMIN only)
- [ ] DELETE /api/workorders/[id] (delete - SUPERADMIN only)
- [ ] GET /api/workorders/[id]/plants (get work order plants)
- [ ] POST /api/workorders/[id]/plants (add plants)
- [ ] DELETE /api/workorders/[id]/plants/[plantId] (remove plant)
- [ ] GET /api/workorders/[id]/production (production metrics)
- [ ] GET /api/workorders/[id]/efficiency (efficiency metrics)
- [ ] GET /api/workorders/org/[orgId] (get org work orders)
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 7: WMS (Weather Monitoring System)
- [ ] WMS Vendor entity (DynamoDB)
- [ ] WMS Site entity (DynamoDB)
- [ ] WMS Device entity (DynamoDB)
- [ ] Insolation Reading entity (DynamoDB with TTL)
- [ ] GET /api/wms-vendors (list)
- [ ] POST /api/wms-vendors (create)
- [ ] GET /api/wms-vendors/[id]/sites (get sites)
- [ ] GET /api/wms-vendors/[id]/devices (get devices)
- [ ] POST /api/wms-vendors/[id]/sync-sites (sync sites)
- [ ] POST /api/wms-vendors/[id]/sync-devices (sync devices)
- [ ] POST /api/wms-vendors/[id]/sync-insolation (sync insolation)
- [ ] GET /api/wms-sites (list)
- [ ] GET /api/wms-sites/[id] (get single site)
- [ ] GET /api/wms-devices (list)
- [ ] GET /api/wms-devices/[id] (get single device)
- [ ] GET /api/insolation-readings (get readings with filters)
- [ ] WMS sync services
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 8: Sync Services (Cron Jobs)
- [ ] Plant sync Lambda (EventBridge trigger)
- [ ] Alert sync Lambda (EventBridge trigger)
- [ ] Live telemetry sync Lambda (EventBridge trigger)
- [ ] WMS site sync Lambda (EventBridge trigger)
- [ ] WMS insolation sync Lambda (EventBridge trigger)
- [ ] Disable inactive plants Lambda (EventBridge trigger)
- [ ] Reset was_online_today Lambda (EventBridge trigger)
- [ ] Analytics config mirror Lambda (EventBridge trigger)
- [ ] Analytics snapshot Lambda (EventBridge trigger)
- [ ] **Tests**: Unit + Integration tests

### Phase 9: Analytics
- [ ] Analytics config mirror service
- [ ] Analytics snapshot service
- [ ] Plant energy readings (DynamoDB with TTL)
- [ ] GET /api/analytics/orgs (org analytics)
- [ ] GET /api/analytics/plants (plant analytics)
- [ ] GET /api/analytics/plants/[id]/energy (energy readings)
- [ ] GET /api/analytics/plants/[id]/grid-downtime (grid downtime)
- [ ] GET /api/analytics/vendors (vendor analytics)
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 10: Dashboard
- [ ] GET /api/dashboard (role-specific dashboard data)
- [ ] Dashboard metrics calculation (SUPERADMIN/GOVT/ORG)
- [ ] **Key Requirement**: Metrics aggregate from plants mapped to work orders only (not all plants)
- [ ] SUPERADMIN: All work orders, all mapped plants
- [ ] GOVT: All work orders, all mapped plants (same as SUPERADMIN, different widgets)
- [ ] ORG: Org work orders, org mapped plants
- [ ] Role-based widget visibility
- [ ] Production metrics: totalEnergyMwh, dailyEnergyMwh, monthlyEnergyMwh, yearlyEnergyMwh, currentPowerKw, installedCapacityKw
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 11: Frontend - Core
- [ ] Next.js 14 setup with App Router
- [ ] Authentication pages (login)
- [ ] Dashboard page (role-adaptive)
- [ ] Layout components (sidebar, header)
- [ ] Theme system (dark/light mode)
- [ ] Navigation system
- [ ] **Tests**: Component tests

### Phase 12: Frontend - Organizations
- [ ] Organizations list page
- [ ] Organization detail page
- [ ] Organization plants view
- [ ] Organization production overview
- [ ] Create/Edit organization modals
- [ ] **Tests**: Component + E2E tests

### Phase 13: Frontend - Vendors
- [ ] Vendors list page
- [ ] Vendor detail page
- [ ] Vendor sync dashboard
- [ ] Create/Edit vendor modals
- [ ] Sync status indicators
- [ ] **Tests**: Component + E2E tests

### Phase 14: Frontend - Plants
- [ ] Plants list page
- [ ] Plant detail page
- [ ] Plant production metrics
- [ ] Plant telemetry charts
- [ ] Plant alerts feed
- [ ] **Tests**: Component + E2E tests

### Phase 15: Frontend - Alerts
- [ ] Alerts list page
- [ ] Alert detail view
- [ ] Alert filtering and search
- [ ] Alert status management
- [ ] **Tests**: Component + E2E tests

### Phase 16: Frontend - Work Orders
- [ ] Work orders list page
- [ ] Work order detail page
- [ ] Create/Edit work order modals
- [ ] Work order plants management
- [ ] Work order production metrics
- [ ] Work order efficiency metrics
- [ ] **Tests**: Component + E2E tests

### Phase 17: Frontend - WMS
- [ ] WMS vendors list page
- [ ] WMS sites list page
- [ ] WMS devices list page
- [ ] Insolation charts
- [ ] WMS sync dashboard
- [ ] **Tests**: Component + E2E tests

### Phase 18: Frontend - Analytics
- [ ] Analytics dashboard
- [ ] Plant energy analytics
- [ ] Grid downtime analytics
- [ ] Organization breakdown charts
- [ ] **Tests**: Component + E2E tests

### Phase 19: Frontend - Animations
- [ ] Page transition animations
- [ ] Component mount/unmount animations
- [ ] Data table animations (sorting, filtering)
- [ ] Chart animations
- [ ] Form submission animations
- [ ] Loading state animations
- [ ] Error state animations
- [ ] Success state animations

### Phase 20: Infrastructure
- [ ] Terraform modules for Lambda functions
- [ ] Terraform modules for DynamoDB tables
- [ ] Terraform modules for API Gateway
- [ ] Terraform modules for EventBridge rules
- [ ] Terraform modules for IAM roles/policies
- [ ] Terraform modules for CloudWatch logs
- [ ] Cost optimization configuration
- [ ] Environment-specific configurations (dev/staging/prod)

### Phase 21: Testing & Quality
- [ ] Achieve >90% test coverage
- [ ] All Cucumber features passing
- [ ] Integration tests for all API endpoints
- [ ] E2E tests for critical user flows
- [ ] Performance testing
- [ ] Load testing (30 concurrent users)
- [ ] Security testing

### Phase 22: Documentation
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Architecture documentation
- [ ] Deployment guide
- [ ] Developer guide
- [ ] Testing guide
- [ ] Cost analysis document

---

## Current Status
**Last Updated**: 2025-01-15  
**Current Phase**: Phase 0 - Foundation  
**Next Task**: Set up Terraform infrastructure and project structure
**Progress**: Architecture design completed, DynamoDB schema designed

---

## Notes
- All features must match WOMS functionality
- Code must follow SOLID principles
- TDD approach: Write tests first, then implementation
- All tests must pass before moving to next feature
- Update this checklist as features are completed

