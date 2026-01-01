# API Pseudo-Code & DynamoDB Query Patterns

This document captures all API endpoints from WOMS with their pseudo-code and DynamoDB query patterns for the Erooka implementation.

## API Endpoints Summary

### Authentication & User Management
- POST /api/login - Authenticate user and create session
- GET /api/me - Get current user information

### Accounts
- GET /api/accounts - List all accounts (SUPERADMIN only)
- POST /api/accounts - Create account (SUPERADMIN/DEVELOPER only)

### Organizations
- GET /api/orgs - List all organizations
- POST /api/orgs - Create organization (SUPERADMIN only)
- GET /api/orgs/[id] - Get single organization
- GET /api/orgs/[id]/plants - Get organization plants
- GET /api/orgs/[id]/production - Get organization production metrics

### Vendors
- GET /api/vendors - List all vendors
- POST /api/vendors - Create vendor (SUPERADMIN/DEVELOPER only)
- GET /api/vendors/[id] - Get single vendor
- POST /api/vendors/[id]/sync-plants - Sync plants from vendor
- GET /api/vendors/sync-status - Get vendor sync status (SUPERADMIN/DEVELOPER only)

### Plants
- GET /api/plants - List plants (role-filtered)
- GET /api/plants/unassigned - Get unassigned plants
- GET /api/plants/[id] - Get single plant
- GET /api/plants/[id]/production - Get plant production metrics
- GET /api/plants/[id]/telemetry - Get plant telemetry data

### Alerts
- GET /api/alerts - List alerts (with filtering by plantId, role-based)

### Work Orders
- GET /api/workorders - List work orders (role-filtered)
- POST /api/workorders - Create work order (SUPERADMIN/DEVELOPER only)
- GET /api/workorders/[id] - Get single work order
- GET /api/workorders/[id]/production - Get work order production metrics
- POST /api/workorders/[id]/plants - Add plants to work order

### Dashboard
- GET /api/dashboard - Get dashboard metrics (role-specific: SUPERADMIN/GOVT/ORG)

### WMS (Weather Monitoring System)
- GET /api/wms-vendors - List WMS vendors
- GET /api/wms-sites - List WMS sites
- GET /api/insolation-readings - Get insolation readings

---

## Authentication APIs

### POST /api/login

**Purpose**: Authenticate user and create session

**Pseudo-Code**:
```typescript
POST /api/login
Request: { email: string, password: string }

1. Validate email and password are provided
2. Query config table (email-index GSI3):
   - GSI3PK = EMAIL#{email}
   - Filter: is_active = true
3. If account not found → 401 Unauthorized
4. Compare password with stored bcrypt hash
5. If password invalid → 401 Unauthorized
6. Create session:
   - Encode: { accountId, accountType, orgId, email } to base64
   - Set HTTP-only cookie: session={base64Data}
7. Return: { account: { id, email, accountType, orgId } }

DynamoDB Query:
- Table: config
- Index: email-index (GSI3)
- Query: GSI3PK = EMAIL#{email}
- Result: Single account item
```

### GET /api/me

**Purpose**: Get current user information

**Pseudo-Code**:
```typescript
GET /api/me

1. Extract session from cookie
2. Decode base64 session to get accountId
3. Query config table:
   - PK = ACCOUNT
   - SK = {accountId}
4. If account not found → 404 Not Found
5. If SUPERADMIN/DEVELOPER: Use own logo/displayName
   Otherwise: Query first SUPERADMIN account for logo/displayName
6. Return: { account: {...}, superAdmin: {...} }

DynamoDB Query:
- Table: config
- GetItem: PK = ACCOUNT, SK = {accountId}
- If needed: Scan with filter PK = ACCOUNT AND account_type = SUPERADMIN (limit 1)
```

## Account APIs

### GET /api/accounts

**Purpose**: List all accounts (SUPERADMIN only)

**Pseudo-Code**:
```typescript
GET /api/accounts

1. Validate session
2. Check permission: requirePermission(accountType, "accounts", "read")
3. Scan config table:
   - Filter: PK = ACCOUNT
   - Order: email (ascending)
4. Return: { accounts: [...] }

DynamoDB Query:
- Table: config
- Scan: FilterExpression PK = ACCOUNT
- Sort in application layer by email
```

### POST /api/accounts

**Purpose**: Create new account (SUPERADMIN/DEVELOPER only)

**Pseudo-Code**:
```typescript
POST /api/accounts
Request: { email, password, account_type, org_id?, display_name? }

1. Validate session
2. Check permission: SUPERADMIN or DEVELOPER
3. Validate account_type (SUPERADMIN, ORG, GOVT - not DEVELOPER)
4. Validate org_id:
   - Required if account_type = ORG
   - Must be null for SUPERADMIN/GOVT/DEVELOPER
5. Hash password with bcrypt
6. Check email uniqueness: Query email-index
7. For ORG accounts: Check org doesn't already have account
8. Insert into config table:
   - PK = ACCOUNT
   - SK = {newUUID}
   - GSI3PK = EMAIL#{email}
   - GSI3SK = ACCOUNT#{accountId}
9. Return: { account: {...} }

DynamoDB Operations:
- Query email-index: GSI3PK = EMAIL#{email}
- If ORG: Query org-index: GSI1PK = ORG#{org_id}, GSI1SK = ACCOUNT#*
- PutItem: New account with all attributes
```

## Organization APIs

### GET /api/orgs

**Purpose**: List all organizations

**Pseudo-Code**:
```typescript
GET /api/orgs

1. Validate session
2. Check permission: requirePermission(accountType, "organizations", "read")
3. Scan config table:
   - Filter: PK = ORG
4. Return: { orgs: [...] } (sorted by name)

DynamoDB Query:
- Table: config
- Scan: FilterExpression PK = ORG
- Sort in application layer by name
```

### POST /api/orgs

**Purpose**: Create organization (SUPERADMIN only)

**Pseudo-Code**:
```typescript
POST /api/orgs
Request: { name: string }

1. Validate session
2. Check permission: requirePermission(accountType, "organizations", "create")
3. Validate name is provided
4. Generate new org ID
5. Insert into config table:
   - PK = ORG
   - SK = {orgId}
   - GSI1PK = ORG#{orgId} (for consistency)
   - GSI1SK = ORG#{orgId}
6. Return: { org: {...} }

DynamoDB Operation:
- PutItem: PK = ORG, SK = {orgId}, name = {name}
```

### GET /api/orgs/[id]

**Purpose**: Get single organization

**Pseudo-Code**:
```typescript
GET /api/orgs/[id]

1. Validate session
2. GetItem from config table:
   - PK = ORG
   - SK = {orgId}
3. Return: { org: {...} }

DynamoDB Query:
- Table: config
- GetItem: PK = ORG, SK = {orgId}
```

### GET /api/orgs/[id]/plants

**Pseudo-Code**:
```typescript
GET /api/orgs/[id]/plants

1. Validate session
2. Query plants table (org-index GSI1):
   - GSI1PK = ORG#{orgId}
   - GSI1SK begins_with PLANT#
3. Include vendor and organization data (BatchGetItem for vendors/orgs)
4. Return: { plants: [...] }

DynamoDB Query:
- Table: plants
- Index: org-index (GSI1)
- Query: GSI1PK = ORG#{orgId}, GSI1SK begins_with PLANT#
```

### GET /api/orgs/[id]/production

**Pseudo-Code**:
```typescript
GET /api/orgs/[id]/production

1. Validate session
2. Query config table for work orders:
   - GSI1PK = ORG#{orgId}
   - GSI1SK begins_with WORK_ORDER#
3. Extract work_order_ids
4. Query work-order-plants table for each work order:
   - PK = WORK_ORDER#{woId}
   - Filter: is_active = true
5. Extract unique plant_ids
6. BatchGetItem plants table for all plant_ids
7. Aggregate metrics:
   - totalEnergyMwh = sum(plants.total_energy_mwh)
   - dailyEnergyMwh = sum(plants.daily_energy_kwh / 1000)
   - monthlyEnergyMwh = sum(plants.monthly_energy_mwh)
   - yearlyEnergyMwh = sum(plants.yearly_energy_mwh)
   - currentPowerKw = sum(plants.current_power_kw)
   - installedCapacityKw = sum(plants.capacity_kw)
8. Return: { totalWorkOrders, totalPlants, aggregated: {...} }

DynamoDB Queries:
- Query config (org-index): GSI1PK = ORG#{orgId}, GSI1SK begins_with WORK_ORDER#
- Query work-order-plants: PK = WORK_ORDER#{woId} for each work order
- BatchGetItem plants: Multiple batches of 25 plant_ids
```

## Vendor APIs

### GET /api/vendors

**Pseudo-Code**:
```typescript
GET /api/vendors

1. Validate session
2. Check permission: requirePermission(accountType, "vendors", "read")
3. Scan config table:
   - Filter: PK = VENDOR
4. For each vendor, BatchGetItem organizations (if org_id present)
5. Return: { vendors: [...], orgs: [...] }

DynamoDB Query:
- Table: config
- Scan: FilterExpression PK = VENDOR
- BatchGetItem organizations for org_ids
```

### POST /api/vendors

**Pseudo-Code**:
```typescript
POST /api/vendors
Request: { name, vendor_type, credentials, org_id, is_active, ...sync config }

1. Validate session
2. Check permission: requirePermission(accountType, "vendors", "create")
3. Validate required fields
4. Validate org_id exists (Query config table)
5. Insert into config table:
   - PK = VENDOR
   - SK = {vendorId}
   - GSI1PK = ORG#{org_id}
   - GSI1SK = VENDOR#{vendorId}
   - GSI2PK = VENDOR#{vendorId} (for vendor-index consistency)
6. Return: { vendor: {...} }

DynamoDB Operations:
- Query config: PK = ORG, SK = {org_id} (verify org exists)
- PutItem: New vendor with all attributes
```

### GET /api/vendors/[id]

**Pseudo-Code**:
```typescript
GET /api/vendors/[id]

1. Validate session
2. GetItem from config table:
   - PK = VENDOR
   - SK = {vendorId}
3. Include organization data (BatchGetItem)
4. Return: { vendor: {...} }

DynamoDB Query:
- GetItem: PK = VENDOR, SK = {vendorId}
- BatchGetItem: PK = ORG, SK = {org_id}
```

### POST /api/vendors/[id]/sync-plants

**Pseudo-Code**:
```typescript
POST /api/vendors/[id]/sync-plants

1. Validate session (SUPERADMIN/DEVELOPER)
2. Get vendor from config table
3. Get vendor adapter (VendorManager.getAdapter)
4. Authenticate with vendor API
5. List plants from vendor API
6. For each plant:
   - Query plants table (vendor-plant-unique-index):
     - GSI3PK = VENDOR#{vendorId}
     - GSI3SK = PLANT#{vendor_plant_id}
   - If exists: Update
   - If not: Insert
   - Use BatchWriteItem (25 items per batch)
7. Update vendor.last_synced_at
8. Return: { synced: count, updated: count, created: count }

DynamoDB Operations:
- GetItem vendor: PK = VENDOR, SK = {vendorId}
- Query plants (vendor-plant-unique-index) for each vendor_plant_id
- BatchWriteItem: Update/Insert plants (25 per batch)
- UpdateItem vendor: Set last_synced_at
```

### GET /api/vendors/sync-status

**Pseudo-Code**:
```typescript
GET /api/vendors/sync-status

1. Validate session (SUPERADMIN/DEVELOPER only)
2. Scan config table:
   - Filter: PK = VENDOR
3. For each vendor, BatchGetItem organizations
4. Return: { vendors: [{ id, name, last_synced_at, organizations: {...} }] }

DynamoDB Query:
- Scan config: FilterExpression PK = VENDOR
- BatchGetItem organizations
```

## Plant APIs

### GET /api/plants

**Pseudo-Code**:
```typescript
GET /api/plants

1. Validate session
2. Check permission: requirePermission(accountType, "plants", "read")
3. If ORG user:
   - Query plants table (org-index):
     - GSI1PK = ORG#{orgId}
     - GSI1SK begins_with PLANT#
4. If GOVT user:
   - Query work-order-plants (get all active mappings)
   - Extract plant_ids
   - BatchGetItem plants table
5. If SUPERADMIN:
   - Scan plants table
6. Include vendor and organization data (BatchGetItem)
7. Return: { plants: [...] }

DynamoDB Queries:
- ORG: Query plants (org-index): GSI1PK = ORG#{orgId}
- GOVT: Query work-order-plants → BatchGetItem plants
- SUPERADMIN: Scan plants table
- BatchGetItem vendors and organizations
```

### GET /api/plants/unassigned

**Pseudo-Code**:
```typescript
GET /api/plants/unassigned?orgIds=1,2,3

1. Validate session
2. Query plants table:
   - GSI1PK = ORG#{orgId} for each orgId
   - GSI1SK begins_with PLANT#
3. Query work-order-plants table:
   - Get all active mappings (is_active = true)
4. Filter out plants that are in active work orders
5. Return: { plants: [...], total, assigned }

DynamoDB Queries:
- Query plants (org-index) for each orgId
- Scan work-order-plants: FilterExpression is_active = true
- Filter in application layer
```

### GET /api/plants/[id]

**Pseudo-Code**:
```typescript
GET /api/plants/[id]

1. Validate session
2. GetItem from plants table:
   - PK = PLANT#{plantId}
   - SK = PLANT#{plantId}
3. BatchGetItem vendor and organization
4. Return: { plant: {...} }

DynamoDB Query:
- GetItem: PK = PLANT#{plantId}, SK = PLANT#{plantId}
- BatchGetItem: vendor and organization
```

### GET /api/plants/[id]/production

**Pseudo-Code**:
```typescript
GET /api/plants/[id]/production

1. Validate session
2. GetItem from plants table
3. Extract production metrics from plant item
4. Return: { plantId, metrics: { capacity_kw, current_power_kw, ... } }

DynamoDB Query:
- GetItem: PK = PLANT#{plantId}, SK = PLANT#{plantId}
- Metrics are stored directly in plant item
```

### GET /api/plants/[id]/telemetry

**Pseudo-Code**:
```typescript
GET /api/plants/[id]/telemetry?year=2025&month=1&day=15

1. Validate session
2. GetItem plant from plants table
3. BatchGetItem vendor from config table
4. Get vendor adapter (VendorManager.getAdapter)
5. Call vendor API:
   - adapter.getDailyTelemetryRecords(vendor_plant_id, year, month, day)
6. Transform vendor response to standard format
7. Return: { plantId, data: [...], statistics: {...} }

DynamoDB Queries:
- GetItem plant: PK = PLANT#{plantId}
- GetItem vendor: PK = VENDOR, SK = {vendorId}
- Telemetry fetched from vendor API (not stored in DynamoDB)
```

## Alert APIs

### GET /api/alerts

**Pseudo-Code**:
```typescript
GET /api/alerts?plantId=123&limit=100

1. Validate session
2. Check permission: requirePermission(accountType, "alerts", "read")
3. If plantId provided:
   - Query alerts table (plant-alert-index GSI2):
     - GSI2PK = PLANT#{plantId}
     - Order: created_at DESC
     - Limit: limit (max 200)
4. If ORG user:
   - Query plants (org-index) to get plant_ids
   - Query alerts (plant-alert-index) for each plant_id
   - Merge results
5. If SUPERADMIN/GOVT:
   - Scan alerts table (or query date-index for recent)
6. BatchGetItem plants for plant_id
7. Return: { alerts: [...] }

DynamoDB Queries:
- Query alerts (plant-alert-index): GSI2PK = PLANT#{plantId}
- ORG: Query plants (org-index) → Query alerts for each plant
- SUPERADMIN: Scan alerts or Query date-index for recent
- BatchGetItem plants
```

## Work Order APIs

### GET /api/workorders

**Pseudo-Code**:
```typescript
GET /api/workorders?orgId=1

1. Validate session
2. If orgId query param:
   - Query config table (org-index):
     - GSI1PK = ORG#{orgId}
     - GSI1SK begins_with WORK_ORDER#
3. If ORG user:
   - Query config table (org-index):
     - GSI1PK = ORG#{orgId}
     - GSI1SK begins_with WORK_ORDER#
4. If SUPERADMIN/GOVT without orgId:
   - Scan config table: PK = WORK_ORDER
5. For each work order, Query work-order-plants:
   - PK = WORK_ORDER#{woId}
   - Include plants data
6. If SUPERADMIN/DEVELOPER and wms_device_id exists:
   - BatchGetItem wms_devices from wms table
7. Return: { workOrders: [...] }

DynamoDB Queries:
- Query config (org-index) or Scan config (PK = WORK_ORDER)
- Query work-order-plants: PK = WORK_ORDER#{woId} for each work order
- BatchGetItem plants and wms_devices
```

### POST /api/workorders

**Pseudo-Code**:
```typescript
POST /api/workorders
Request: { title, description, plantIds: [...], wmsDeviceId? }

1. Validate session (SUPERADMIN/DEVELOPER)
2. Validate all plants exist (BatchGetItem)
3. Validate all plants belong to same org
4. If wmsDeviceId provided:
   - GetItem wms_device from wms table
   - Verify device belongs to same org as plants
5. Generate work_order_id
6. Insert work order into config table:
   - PK = WORK_ORDER
   - SK = {workOrderId}
   - GSI1PK = ORG#{orgId}
   - GSI1SK = WORK_ORDER#{workOrderId}
7. Deactivate existing active work orders for these plants:
   - Update work-order-plants: Set is_active = false
   - Query: GSI1PK = PLANT#{plantId} for each plant
8. Insert work-order-plants mappings:
   - BatchWriteItem: PK = WORK_ORDER#{woId}, SK = PLANT#{plantId}
   - GSI1PK = PLANT#{plantId}, GSI1SK = WORK_ORDER#{woId}
   - is_active = true
9. Return: { workOrder: {...} }

DynamoDB Operations:
- BatchGetItem plants: Verify existence and org_id
- GetItem wms_device: Verify org_id
- PutItem work_order: New work order
- Query work-order-plants (plant-workorder-index): Find existing active mappings
- BatchWriteItem: Update existing (is_active=false) + Insert new mappings
```

### GET /api/workorders/[id]

**Pseudo-Code**:
```typescript
GET /api/workorders/[id]

1. Validate session
2. GetItem work order from config table
3. If ORG user: Verify org_id matches
4. Query work-order-plants:
   - PK = WORK_ORDER#{woId}
   - Include plants with vendor and organization data
5. If wms_device_id exists and SUPERADMIN/DEVELOPER:
   - GetItem wms_device from wms table
   - Include wms_site and wms_vendor data
6. Return: { workOrder: {...} }

DynamoDB Queries:
- GetItem work_order: PK = WORK_ORDER, SK = {woId}
- Query work-order-plants: PK = WORK_ORDER#{woId}
- BatchGetItem plants, vendors, organizations
- GetItem wms_device, wms_site, wms_vendor (if applicable)
```

### GET /api/workorders/[id]/production

**Pseudo-Code**:
```typescript
GET /api/workorders/[id]/production

1. Validate session
2. Query work-order-plants:
   - PK = WORK_ORDER#{woId}
   - Filter: is_active = true
3. Extract plant_ids
4. BatchGetItem plants table for all plant_ids
5. Aggregate metrics:
   - Sum all plant metrics
6. Return: { totalPlants, aggregated: {...}, plants: [...] }

DynamoDB Queries:
- Query work-order-plants: PK = WORK_ORDER#{woId}
- BatchGetItem plants: Multiple batches of 25 plant_ids
```

### POST /api/workorders/[id]/plants

**Pseudo-Code**:
```typescript
POST /api/workorders/[id]/plants
Request: { plantIds: [...] }

1. Validate session (SUPERADMIN/DEVELOPER)
2. Get work order from config table
3. Query existing work-order-plants to get org_id
4. BatchGetItem plants: Verify existence and org_id matches
5. Deactivate existing active mappings for these plants
6. BatchWriteItem: Insert new work-order-plants mappings
7. Return: { plants: [...] }

DynamoDB Operations:
- GetItem work_order: PK = WORK_ORDER, SK = {woId}
- Query work-order-plants: Get existing mappings
- BatchGetItem plants: Verify org_id
- BatchWriteItem: Update (is_active=false) + Insert new
```

## Dashboard API

### GET /api/dashboard

**Pseudo-Code**:
```typescript
GET /api/dashboard

1. Validate session
2. If SUPERADMIN/DEVELOPER:
   a. Scan config table: PK = WORK_ORDER (count work orders)
   b. Scan plants table (count total plants)
   c. Query work-order-plants: Get all active mappings (extract plant_ids)
   d. Count mapped plants (unique plant_ids)
   e. Query alerts table (date-index): Filter status = ACTIVE (count)
   f. BatchGetItem plants for mapped plant_ids
   g. Aggregate production metrics from mapped plants
3. If GOVT:
   a. Same as SUPERADMIN (all work orders, all mapped plants)
   b. No alerts query
4. If ORG:
   a. Query config (org-index): GSI1PK = ORG#{orgId}, GSI1SK begins_with WORK_ORDER#
   b. Query plants (org-index): GSI1PK = ORG#{orgId}
   c. Query work-order-plants: Get active mappings for org's work orders
   d. Aggregate metrics from org's mapped plants
5. Return: { role, metrics: {...}, widgets: {...} }

DynamoDB Queries:
- Scan config: PK = WORK_ORDER (or Query org-index for ORG users)
- Scan plants (or Query org-index for ORG users)
- Query work-order-plants: Get all active mappings
- Query alerts (date-index): Filter status = ACTIVE
- BatchGetItem plants: For all mapped plant_ids (multiple batches)
```

## WMS APIs

### GET /api/wms-vendors

**Pseudo-Code**:
```typescript
GET /api/wms-vendors

1. Validate session
2. Check permission: requirePermission(accountType, "wms_vendors", "read")
3. Scan wms table:
   - Filter: PK = WMS_VENDOR
4. If ORG user:
   - Filter: org_id = {orgId}
5. BatchGetItem organizations
6. Return: { vendors: [...] }

DynamoDB Query:
- Scan wms: FilterExpression PK = WMS_VENDOR
- If ORG: FilterExpression PK = WMS_VENDOR AND org_id = {orgId}
- BatchGetItem organizations
```

### GET /api/wms-sites

**Pseudo-Code**:
```typescript
GET /api/wms-sites

1. Validate session
2. Query wms table (wms-vendor-index GSI1):
   - GSI1PK = WMS_VENDOR#{wms_vendor_id}
   - GSI1SK begins_with WMS_SITE#
3. Return: { sites: [...] }

DynamoDB Query:
- Query wms (wms-vendor-index): GSI1PK = WMS_VENDOR#{vendorId}
```

### GET /api/insolation-readings

**Pseudo-Code**:
```typescript
GET /api/insolation-readings?wmsDeviceId=123&startDate=2025-01-01&endDate=2025-01-31

1. Validate session
2. Query wms table (date-index GSI4):
   - GSI4PK = DATE#{date} (for each date in range)
   - GSI4SK = WMS_DEVICE#{deviceId}
3. Merge results from all dates
4. Return: { readings: [...] }

DynamoDB Query:
- Query wms (date-index): Multiple queries for date range
- GSI4PK = DATE#{date}, GSI4SK = WMS_DEVICE#{deviceId}
```

## Query Optimization Notes

### Critical Optimizations

1. **Dashboard Queries**: 
   - Use BatchGetItem for plants (25 items per batch)
   - Parallel queries where possible (Promise.all)
   - Cache results for 1-5 minutes

2. **Work Order Production**:
   - Query work-order-plants first (filter is_active in query)
   - Use BatchGetItem for plants (don't query individually)

3. **Plant Sync**:
   - Use BatchWriteItem (25 items per batch)
   - Parallel batches for large syncs (up to 15 concurrent)

4. **Alerts by Plant**:
   - Always use plant-alert-index (GSI2)
   - Query with limit (default 100, max 200)
   - Use date-index for time-range queries

5. **Organization Queries**:
   - Use org-index (GSI1) for all org-scoped queries
   - Prefer Query over Scan when possible

### Query Pattern Summary

| Operation | Table | Index | Query Type |
|-----------|-------|-------|------------|
| Login by email | config | email-index (GSI3) | Query |
| Get org vendors | config | org-index (GSI1) | Query |
| Get org plants | plants | org-index (GSI1) | Query |
| Get vendor plants | plants | vendor-index (GSI2) | Query |
| Get plant alerts | alerts | plant-alert-index (GSI2) | Query |
| Get work order plants | work-order-plants | (PK) | Query |
| Get plant work orders | work-order-plants | plant-workorder-index (GSI1) | Query |
| Dashboard metrics | Multiple | Multiple | BatchGetItem |
