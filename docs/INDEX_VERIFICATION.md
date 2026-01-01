# DynamoDB Index Verification Against WOMS SQL Schema

This document verifies that our DynamoDB GSI design correctly maps to all indexes used in the WOMS SQL schema.

## Index Comparison Matrix

### Accounts Table

| WOMS SQL Index | Purpose | DynamoDB Mapping | Status |
|----------------|---------|------------------|--------|
| `idx_accounts_email` | Login lookup (critical path) | `config` table, GSI3: `email-index` (GSI3PK = EMAIL#{email}) | ✅ **MATCHES** |
| `idx_accounts_org_id` | Query accounts by org | `config` table, GSI1: `org-index` (GSI1PK = ORG#{orgId}, GSI1SK = ACCOUNT#*) | ✅ **MATCHES** |
| `idx_accounts_account_type` | Filter by account type | Filter in Query/Scan (low volume, acceptable) | ⚠️ **FILTER IN APP** |
| `idx_accounts_is_active` | Filter active accounts | Filter in Query (GSI3 query with FilterExpression) | ⚠️ **FILTER IN APP** |

**Analysis**: 
- ✅ Email index is critical for login (matches perfectly)
- ✅ Org queries covered by org-index
- ⚠️ Account type and is_active are filters (can use FilterExpression on GSI queries)

### Vendors Table

| WOMS SQL Index | Purpose | DynamoDB Mapping | Status |
|----------------|---------|------------------|--------|
| `idx_vendors_org_id` | Query vendors by org | `config` table, GSI1: `org-index` (GSI1PK = ORG#{orgId}, GSI1SK = VENDOR#*) | ✅ **MATCHES** |
| `idx_vendors_token_expires_at` | Find vendors with expired tokens | `config` table, GSI4: `vendor-token-index` (GSI4PK = VENDOR#{vendorId}, GSI4SK = TOKEN#{expires_at}) | ✅ **MATCHES** |
| `idx_vendors_last_alert_synced_at` | Track sync status | Stored in item, sorted in application layer (low volume) | ⚠️ **APP SORT** |

**Analysis**:
- ✅ Both critical indexes mapped correctly
- Token expiration index matches for token refresh queries

### Plants Table

| WOMS SQL Index | Purpose | DynamoDB Mapping | Status |
|----------------|---------|------------------|--------|
| `idx_plants_org_id` | **MOST COMMON** - Query plants by org | `plants` table, GSI1: `org-index` (GSI1PK = ORG#{orgId}) | ✅ **MATCHES** |
| `idx_plants_vendor_id` | Query plants by vendor (sync operations) | `plants` table, GSI2: `vendor-index` (GSI2PK = VENDOR#{vendorId}) | ✅ **MATCHES** |
| `idx_plants_vendor_id_org_id` | Composite query by vendor+org | Use GSI2 with FilterExpression on org_id | ✅ **COVERED** |
| `idx_plants_last_update_time` | Time-based queries | Not commonly queried, can use FilterExpression if needed | ⚠️ **RARE QUERY** |
| `idx_plants_network_status` | Filter by network status | `plants` table, GSI4: `status-index` (GSI4PK = STATUS#{network_status}) | ✅ **MATCHES** |

**Analysis**:
- ✅ All critical indexes mapped correctly
- ✅ Composite index covered by vendor-index + filter
- ⚠️ Time-based queries are rare (acceptable to filter in app)

### Alerts Table

| WOMS SQL Index | Purpose | DynamoDB Mapping | Status |
|----------------|---------|------------------|--------|
| `idx_alerts_plant_id` | **MOST COMMON** - Query alerts by plant (35K/day) | `alerts` table, GSI2: `plant-alert-index` (GSI2PK = PLANT#{plantId}) | ✅ **MATCHES** |
| `idx_alerts_status` | Filter active alerts | Use FilterExpression on GSI2 (plant-alert-index) queries | ✅ **COVERED** |
| `idx_alerts_created_at` | Sort by creation time | GSI2 sort key includes timestamp (GSI2SK = TIMESTAMP#alert_id) | ✅ **COVERED** |
| `idx_alerts_vendor_alert_device` | Deduplication during sync | `alerts` table, GSI3: `vendor-alert-index` (GSI3PK = VENDOR#...#PLANT#..., GSI3SK = vendor_alert_id#TIMESTAMP) | ✅ **MATCHES** |
| `idx_alerts_vendor_time` | Composite vendor+plant+time | Covered by GSI3 (vendor-alert-index) with time in sort key | ✅ **COVERED** |
| `idx_alerts_vendor_vendor_plant` | Alternative deduplication | Covered by GSI3 | ✅ **COVERED** |

**Analysis**:
- ✅ All critical indexes mapped correctly
- ✅ Most common query (plant_id) has dedicated GSI
- ✅ Deduplication indexes properly mapped

### Work Orders Table

| WOMS SQL Index | Purpose | DynamoDB Mapping | Status |
|----------------|---------|------------------|--------|
| `idx_work_orders_org_id` | Query work orders by org | `config` table, GSI1: `org-index` (GSI1PK = ORG#{orgId}, GSI1SK = WORK_ORDER#*) | ✅ **MATCHES** |
| `idx_work_orders_wms_device_id` | Query work orders by WMS device | Filter in Query/Scan (low volume, rare query) | ⚠️ **FILTER IN APP** |
| `idx_work_orders_location` | Geographic queries | Not used in current codebase | ❌ **NOT USED** |
| `idx_work_orders_created_by` | Query by creator | Not used in current codebase | ❌ **NOT USED** |

**Analysis**:
- ✅ Critical org_id index mapped correctly
- ⚠️ WMS device lookup is rare (acceptable to filter)
- ❌ Location and created_by indexes not used (can be added if needed)

### Work Order Plants Table

| WOMS SQL Index | Purpose | DynamoDB Mapping | Status |
|----------------|---------|------------------|--------|
| `idx_work_order_plants_work_order_id` | Query plants in work order | `work-order-plants` table, PK = WORK_ORDER#{woId} | ✅ **MATCHES** |
| `idx_work_order_plants_plant_id` | Query work orders for plant | `work-order-plants` table, GSI1: `plant-workorder-index` (GSI1PK = PLANT#{plantId}) | ✅ **MATCHES** |
| `uq_active_plant` | **UNIQUE** constraint: One active work order per plant | Enforce in application layer (query GSI1 before insert, check is_active=true) | ⚠️ **APP ENFORCEMENT** |

**Analysis**:
- ✅ Both indexes mapped correctly
- ⚠️ Unique constraint must be enforced in application layer (DynamoDB doesn't support conditional unique constraints)

### WMS Tables

| WOMS SQL Index | Purpose | DynamoDB Mapping | Status |
|----------------|---------|------------------|--------|
| `idx_wms_vendors_org_id` | Query WMS vendors by org | `wms` table, GSI3: `wms-org-index` (GSI3PK = ORG#{orgId}) | ✅ **MATCHES** |
| `idx_wms_vendors_token_expires_at` | Token refresh | Store in item, query with FilterExpression (low volume) | ⚠️ **FILTER IN APP** |
| `idx_wms_sites_wms_vendor_id` | Query sites by vendor | `wms` table, GSI1: `wms-vendor-index` (GSI1PK = WMS_VENDOR#{vendorId}, GSI1SK = WMS_SITE#*) | ✅ **MATCHES** |
| `idx_wms_sites_org_id` | Query sites by org | `wms` table, GSI3: `wms-org-index` (GSI3PK = ORG#{orgId}, GSI3SK = WMS_SITE#*) | ✅ **MATCHES** |
| `idx_wms_devices_wms_site_id` | Query devices by site | `wms` table, GSI2: `wms-site-index` (GSI2PK = WMS_SITE#{siteId}, GSI2SK = WMS_DEVICE#*) | ✅ **MATCHES** |
| `idx_insolation_readings_wms_device_id` | Query readings by device | `wms` table, PK query (PK = INSULATION, SK begins_with device_id#date) | ✅ **MATCHES** |
| `idx_insolation_readings_reading_date` | Query readings by date | `wms` table, GSI4: `insolation-date-index` (GSI4PK = DATE#{date}) | ✅ **MATCHES** |
| `idx_insolation_readings_device_date` | Composite device+date | Covered by GSI4 sort key | ✅ **COVERED** |

**Analysis**:
- ✅ All critical WMS indexes mapped correctly
- ✅ Date-based queries properly indexed

## Critical Findings

### ✅ Correctly Mapped (Most Important)

1. **Login Performance** (Critical Path):
   - `idx_accounts_email` → GSI3: `email-index` ✅

2. **Most Common Queries**:
   - `idx_plants_org_id` → GSI1: `org-index` ✅
   - `idx_alerts_plant_id` → GSI2: `plant-alert-index` ✅ (35K queries/day)

3. **Sync Operations**:
   - `idx_plants_vendor_id` → GSI2: `vendor-index` ✅
   - `idx_alerts_vendor_alert_device` → GSI3: `vendor-alert-index` ✅

4. **RBAC Filtering**:
   - All `org_id` indexes → GSI1: `org-index` ✅

### ⚠️ Require Application-Level Handling

1. **Unique Constraint**:
   - `uq_active_plant` (one active work order per plant)
   - **Solution**: Query GSI1 before insert, verify no active mapping exists
   - **Code Pattern**:
     ```typescript
     // Before inserting work-order-plant mapping
     const existing = await queryGSI('plant-workorder-index', {
       GSI1PK: `PLANT#${plantId}`,
       FilterExpression: 'is_active = :true',
       ExpressionAttributeValues: { ':true': true }
     })
     if (existing.length > 0) {
       throw new Error('Plant already in active work order')
     }
     ```

2. **Filter Expressions** (Low Volume, Acceptable):
   - Account type filtering
   - Active account filtering
   - WMS device filtering
   - Time-based filtering
   - **Solution**: Use FilterExpression on GSI queries (acceptable for low-volume filters)

### ❌ Not Used in Current Codebase

1. `idx_work_orders_location` - Geographic queries not implemented
2. `idx_work_orders_created_by` - Creator tracking not used

**Decision**: Can add these GSIs later if needed, but not critical for initial implementation.

## GSI Count Verification

| Table | GSIs | Limit | Status |
|-------|------|-------|--------|
| `config` | 4 (org-index, vendor-index, email-index, vendor-token-index) | 20 | ✅ OK |
| `plants` | 4 (org-index, vendor-index, vendor-plant-unique-index, status-index) | 20 | ✅ OK |
| `alerts` | 4 (date-index, plant-alert-index, vendor-alert-index, alert-id-index) | 20 | ✅ OK |
| `work-order-plants` | 1 (plant-workorder-index) | 20 | ✅ OK |
| `wms` | 4 (wms-vendor-index, wms-site-index, wms-org-index, insolation-date-index) | 20 | ✅ OK |

**⚠️ ISSUE FOUND**: Alerts table has 5 GSIs, but DynamoDB limit is 20 per table (we're fine, but should consolidate).

**Review of Alerts GSIs**:
1. `date-index` (GSI1) - Query by date
2. `plant-alert-index` (GSI2) - MOST COMMON (supports status filtering via FilterExpression)
3. `vendor-alert-index` (GSI3) - Deduplication
4. `alert-id-index` (GSI4) - Direct lookup

**Decision**: Status filtering uses FilterExpression on GSI2 (plant-alert-index) queries. No separate status-index GSI needed since status is typically queried together with plant_id.

**GSI Count**: 4 GSIs for alerts table ✅

## Summary

### ✅ All Critical Indexes Mapped

- ✅ Login (email) - Critical path
- ✅ Plant queries (org_id, vendor_id) - Most common
- ✅ Alert queries (plant_id) - 35K/day
- ✅ Work order queries (org_id)
- ✅ Deduplication indexes

### ⚠️ Application-Level Requirements

1. **Unique Constraint Enforcement**: One active work order per plant
   - Must query GSI before insert
   - Check is_active = true in application

2. **Filter Expressions**: Use for low-volume filters
   - Account type
   - Active status
   - Time ranges
   - Network status

### ✅ Design Validation

**All critical query patterns from WOMS are correctly mapped to DynamoDB GSIs.**

The design properly handles:
- ✅ Most common queries (org_id, plant_id)
- ✅ Critical path (login email lookup)
- ✅ High-volume patterns (alert queries)
- ✅ Sync operations (vendor queries, deduplication)
- ✅ RBAC filtering (org-based queries)

**Recommendation**: ✅ **APPROVED** - Index design is correct and matches WOMS access patterns.

