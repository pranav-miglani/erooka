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

### Phase 1: Authentication & Authorization ✅
- [x] Account entity (DynamoDB) - Domain model created
- [x] AccountRepository interface and DynamoDB implementation
- [x] AuthService with login, password hashing, session management
- [x] Login API handler (POST /api/login) - Lambda function
- [x] GET /api/me endpoint handler - Lambda function
- [x] POST /api/accounts - Create account (SUPERADMIN only, DEVELOPER deprecated)
- [x] GET /api/accounts - List accounts (SUPERADMIN only)
- [x] AccountService for account management
- [x] Session management (HTTP-only cookies, base64 encoding)
- [x] RBAC system (shared/rbac) - DEVELOPER deprecated, treated as SUPERADMIN
- [ ] Middleware for route protection (API Gateway authorizer)
- [x] Unit tests for AuthService
- [x] Cucumber feature file for authentication
- [ ] Integration tests with DynamoDB Local
- [ ] **Tests**: Complete test coverage

### Phase 2: Organizations ✅
- [x] Organization entity (DynamoDB)
- [x] OrganizationRepository (DynamoDB implementation)
- [x] OrganizationService
- [x] GET /api/orgs (list with RBAC filtering)
- [x] POST /api/orgs (create - SUPERADMIN only)
- [x] GET /api/orgs/[id] (get single org)
- [x] PUT /api/orgs/[id] (update - SUPERADMIN only)
- [x] DELETE /api/orgs/[id] (delete - SUPERADMIN only)
- [ ] GET /api/orgs/[id]/plants (get org plants)
- [ ] GET /api/orgs/[id]/production (production metrics)
- [x] **Tests**: Unit tests for OrganizationService
- [ ] **Tests**: Integration + Cucumber features

### Phase 3: Vendors ✅
- [x] Vendor entity (DynamoDB)
- [x] VendorRepository (DynamoDB implementation)
- [x] VendorService
- [x] GET /api/vendors (list with RBAC filtering)
- [x] POST /api/vendors (create - SUPERADMIN only, DEVELOPER deprecated)
- [x] GET /api/vendors/[id] (get single vendor)
- [x] PUT /api/vendors/[id] (update - SUPERADMIN only, DEVELOPER deprecated)
- [x] DELETE /api/vendors/[id] (delete - SUPERADMIN only, DEVELOPER deprecated)
- [ ] POST /api/vendors/[id]/sync-plants (sync plants)
- [ ] POST /api/vendors/[id]/sync-alerts (sync alerts)
- [ ] GET /api/vendors/[id]/production (production metrics)
- [ ] GET /api/vendors/sync-status (sync status dashboard)
- [x] Vendor adapter system (Strategy + Factory pattern) - Base structure created
- [x] Vendor adapters implementation (Solarman, SolarDM, ShineMonitor, PVBlink, FoxessCloud) - ✅ Complete (~2180 lines)
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 4: Plants ✅
- [x] Plant entity (DynamoDB) - Domain model with production metrics
- [x] PlantRepository (DynamoDB implementation) - Batch update support
- [x] PlantService
- [x] GET /api/plants (list with RBAC filtering)
- [x] POST /api/plants (create - SUPERADMIN only)
- [x] GET /api/plants/[id] (get single plant)
- [x] PUT /api/plants/[id] (update - SUPERADMIN only)
- [ ] GET /api/plants/[id]/production (production metrics)
- [ ] GET /api/plants/[id]/telemetry (telemetry data)
- [ ] GET /api/plants/unassigned (unassigned plants)
- [ ] Plant sync service
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 5: Alerts 🚧
- [x] Alert entity (DynamoDB with TTL) - Domain model created
- [x] AlertRepository (DynamoDB implementation) - GSI queries, batch create
- [x] AlertService - Business logic, validation
- [x] GET /api/alerts (list with RBAC filtering, pagination)
- [x] GET /api/alerts?plantId=X (filter by plant)
- [x] PATCH /api/alerts/[id] (update status - SUPERADMIN only)
- [ ] Alert sync service (requires vendor adapters)
- [ ] Alert deduplication logic (requires vendor_plant_id in Alert entity)
- [ ] Grid downtime calculation
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 6: Work Orders ✅
- [x] Work Order entity (DynamoDB) - Domain model created
- [x] Work Order Plant mappings table (work-order-plants, DynamoDB) - Repository created
- [x] WorkOrderRepository (DynamoDB implementation)
- [x] WorkOrderPlantRepository (DynamoDB implementation)
- [x] WorkOrderService - Business logic, validation, one active per plant enforcement
- [x] GET /api/workorders (list with RBAC filtering)
- [x] POST /api/workorders (create - SUPERADMIN only)
- [x] GET /api/workorders/[id] (get single work order)
- [x] PUT /api/workorders/[id] (update - SUPERADMIN only)
- [x] DELETE /api/workorders/[id] (delete - SUPERADMIN only)
- [x] GET /api/workorders/[id]/production (production metrics)
- [ ] GET /api/workorders/[id]/plants (get work order plants - can use GET /api/workorders/[id])
- [ ] POST /api/workorders/[id]/plants (add plants - can use PUT /api/workorders/[id] with plantIds)
- [ ] DELETE /api/workorders/[id]/plants/[plantId] (remove plant - can use PUT /api/workorders/[id])
- [ ] GET /api/workorders/[id]/efficiency (efficiency metrics)
- [ ] GET /api/workorders/org/[orgId] (get org work orders - can use GET /api/workorders?orgId=X)
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 7: WMS (Weather Monitoring System) ✅
- [x] WMS Vendor entity (DynamoDB) - Domain model created
- [x] WMS Site entity (DynamoDB) - Domain model created
- [x] WMS Device entity (DynamoDB) - Domain model created
- [x] Insolation Reading entity (DynamoDB with TTL) - Domain model created
- [x] WMSVendorRepository (DynamoDB implementation)
- [x] WMSSiteRepository (DynamoDB implementation)
- [x] WMSDeviceRepository (DynamoDB implementation)
- [x] InsolationReadingRepository (DynamoDB implementation)
- [x] WMSService - Business logic and validation
- [x] GET /api/wms-vendors (list with RBAC filtering)
- [x] POST /api/wms-vendors (create - SUPERADMIN only)
- [x] GET /api/wms-sites (list with filters)
- [x] GET /api/wms-devices (list with filters)
- [x] GET /api/insolation-readings (get readings with filters)
- [ ] GET /api/wms-vendors/[id]/sites (get sites - can use GET /api/wms-sites?vendorId=X)
- [ ] GET /api/wms-vendors/[id]/devices (get devices - can use GET /api/wms-devices?vendorId=X)
- [ ] POST /api/wms-vendors/[id]/sync-sites (sync sites - requires WMS adapters)
- [ ] POST /api/wms-vendors/[id]/sync-devices (sync devices - requires WMS adapters)
- [ ] POST /api/wms-vendors/[id]/sync-insolation (sync insolation - requires WMS adapters)
- [ ] WMS sync services (requires WMS adapters)
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 8: Sync Services (Cron Jobs) ✅
- [x] Plant sync Lambda (EventBridge trigger) - ✅ Complete
- [x] Alert sync Lambda (EventBridge trigger) - ✅ Complete
- [x] Live telemetry sync Lambda (EventBridge trigger) - ✅ Complete
- [x] WMS site sync Lambda (EventBridge trigger) - ✅ Complete
- [x] WMS insolation sync Lambda (EventBridge trigger) - ✅ Complete
- [ ] Disable inactive plants Lambda (EventBridge trigger)
- [ ] Reset was_online_today Lambda (EventBridge trigger)
- [ ] Analytics config mirror Lambda (EventBridge trigger)
- [ ] Analytics snapshot Lambda (EventBridge trigger)
- [ ] **Tests**: Unit + Integration tests

### Phase 9: Analytics ✅
- [x] AnalyticsService - Comprehensive analytics service - ✅ Complete
- [x] GET /api/analytics/orgs (org analytics) - ✅ Complete
- [x] GET /api/analytics/plants (plant analytics) - ✅ Complete
- [x] GET /api/analytics/plants/[id]/energy (energy readings) - ✅ Complete
- [x] GET /api/analytics/plants/[id]/grid-downtime (grid downtime) - ✅ Complete
- [x] GET /api/analytics/vendors (vendor analytics) - ✅ Complete
- [ ] Plant energy readings (DynamoDB with TTL) - Time-series table (optional, can use current plant metrics)
- [ ] Analytics config mirror service (optional)
- [ ] Analytics snapshot service (optional)
- [ ] **Tests**: Unit + Integration + Cucumber features

### Phase 10: Dashboard ✅
- [x] GET /api/dashboard (role-specific dashboard data)
- [x] Dashboard metrics calculation (SUPERADMIN/GOVT/ORG)
- [x] **Key Requirement**: Metrics aggregate from plants mapped to work orders only (not all plants)
- [x] SUPERADMIN: All work orders, all mapped plants, active alerts
- [x] GOVT: All work orders, all mapped plants, no alerts
- [x] ORG: Org work orders, org mapped plants, org active alerts
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
**Current Phase**: Phase 5 - Alerts (In Progress)  
**Next Task**: Complete AlertRepository and AlertService, then continue with Work Orders
**Progress**: 
- ✅ Phases 1-4 completed (Auth, Organizations, Vendors, Plants)
- 🚧 Phase 5 started (Alerts domain entity created)
- 📋 Remaining: Alerts (repository/service/API), Work Orders, WMS, Sync Services, Analytics, Dashboard, Frontend, Infrastructure

---

## Notes
- All features must match WOMS functionality
- Code must follow SOLID principles
- TDD approach: Write tests first, then implementation
- All tests must pass before moving to next feature
- Update this checklist as features are completed

