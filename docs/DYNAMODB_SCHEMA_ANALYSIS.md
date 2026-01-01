# DynamoDB Schema Design Analysis

## Executive Summary

After analyzing the WOMS SQL schema and access patterns, **I recommend a MULTI-TABLE design** instead of single-table. Here's why:

## Key Findings from SQL Schema Analysis

### 1. **Distinct Data Characteristics**

| Entity Type | Volume | Access Pattern | TTL | Characteristics |
|------------|--------|----------------|-----|-----------------|
| **Accounts** | ~30-100 | Email lookup (login), org_id queries | No | Low volume, critical path |
| **Organizations** | ~10-50 | Simple CRUD | No | Low volume, simple |
| **Vendors** | ~50-200 | org_id queries, token refresh | No | Medium volume, token management |
| **Plants** | 7,000 max | org_id (most common), vendor_id, unique constraint | No | **Core entity, multiple access patterns** |
| **Alerts** | 35K/day (1M/month) | plant_id (MOST COMMON), deduplication | Yes (365 days) | **High volume, time-series** |
| **Work Orders** | ~100-500 | org_id queries | No | Low volume |
| **WMS** | Separate domain | wms_vendor_id, wms_site_id | Yes (100 days) | **Separate domain, different access patterns** |

### 2. **Access Pattern Analysis**

#### Most Common Queries (from SQL indexes):
1. **Alerts by plant_id** - `idx_alerts_plant_id` (MOST COMMON - 35K/day)
2. **Plants by org_id** - `idx_plants_org_id` (Dashboard, org views)
3. **Account by email** - `idx_accounts_email` (Login - critical path)
4. **Plants by vendor_id** - `idx_plants_vendor_id` (Vendor sync)
5. **Alerts deduplication** - `idx_alerts_vendor_alert_device` (Sync operations)
6. **Work orders by org_id** - `idx_work_orders_org_id` (Org views)

#### Key Observations:
- **Alerts** are HIGH VOLUME (1M/month) with TTL - needs separate table
- **Plants** are the CORE entity (7K) with multiple access patterns - deserves dedicated table
- **WMS** is a SEPARATE domain (weather monitoring vs solar plants) - should be separate
- **Config entities** (accounts, orgs, vendors, work orders) are LOW VOLUME - can share a table

## Recommended Multi-Table Design

### ✅ **Option 1: Multi-Table Design (RECOMMENDED)**

#### Table 1: `config` (Configuration Entities)
**Purpose**: Low-volume configuration entities with simple access patterns

**Entities**: Accounts, Organizations, Vendors, Work Orders

**Primary Key**:
- **PK**: `ENTITY_TYPE` (STRING) - `ACCOUNT`, `ORG`, `VENDOR`, `WORK_ORDER`
- **SK**: `ENTITY_ID` (STRING)

**GSIs**:
1. **GSI1: `org-index`** - Query entities by organization
   - GSI1PK: `ORG#org_id`
   - GSI1SK: `ENTITY_TYPE#ENTITY_ID`
2. **GSI2: `email-index`** - Account lookup by email (login)
   - GSI2PK: `EMAIL#email`
   - GSI2SK: `ACCOUNT#account_id`
3. **GSI3: `vendor-token-index`** - Token refresh queries
   - GSI3PK: `VENDOR#vendor_id`
   - GSI3SK: `TOKEN#expires_at` (for expired token queries)

**Why Separate**: Low volume, simple access patterns, no TTL requirements

---

#### Table 2: `plants` (Plants - Core Entity)

**Data Hierarchy**: Work Order → Organization → Vendors → Plants
- Work Orders are assigned to Organizations
- Organizations have multiple Vendors (20-50 max per org)
- Each Vendor has multiple Plants
- Work Orders can contain Plants from multiple Vendors within the same Organization
**Purpose**: Core entity with multiple access patterns (7K plants max)

**Primary Key**:
- **PK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **SK**: `PLANT#plant_id` (STRING) - same as PK for direct lookup

**GSIs**:
1. **GSI1: `org-index`** - Query plants by organization (MOST COMMON)
   - GSI1PK: `ORG#org_id`
   - GSI1SK: `PLANT#plant_id`
   - **Query**: `GSI1PK = ORG#1` (get all plants for org)
2. **GSI2: `vendor-index`** - Query plants by vendor
   - GSI2PK: `VENDOR#vendor_id`
   - GSI2SK: `PLANT#plant_id`
   - **Query**: `GSI2PK = VENDOR#5` (get all plants for vendor)
3. **GSI3: `vendor-plant-unique-index`** - Enforce unique constraint
   - GSI3PK: `VENDOR#vendor_id#PLANT#vendor_plant_id`
   - GSI3SK: `PLANT#plant_id`
   - **Query**: `GSI3PK = VENDOR#5#PLANT#STATION123` (uniqueness check)
4. **GSI4: `status-index`** - Query by network status
   - GSI4PK: `STATUS#network_status` (e.g., `STATUS#NORMAL`)
   - GSI4SK: `PLANT#plant_id`
   - **Query**: `GSI4PK = STATUS#NORMAL` (get all normal plants)

**Why Separate**: 
- **Core entity** with 7K items (deserves dedicated table)
- **Multiple access patterns** (org, vendor, status, unique constraint)
- **Rich attributes** (production metrics, location, network status)
- **Frequent queries** (dashboard, org views, vendor sync)

---

#### Table 3: `alerts` (Alerts - High Volume Time-Series)
**Purpose**: High-volume time-series data with TTL (35K alerts/day = 1M/month)

**Primary Key**:
- **PK**: `PLANT#plant_id` (STRING) - Distributes across partitions
- **SK**: `TIMESTAMP#alert_id` (STRING) - `2025-01-15T14:30:00Z#789`

**GSIs**:
1. **GSI1: `plant-alert-index`** - Query alerts by plant (MOST COMMON - 35K/day)
   - GSI1PK: `PLANT#plant_id`
   - GSI1SK: `TIMESTAMP#alert_id`
   - **Query**: `GSI1PK = PLANT#123` with `ScanIndexForward: false` (DESC order)
2. **GSI2: `vendor-alert-index`** - Deduplication during sync
   - GSI2PK: `VENDOR#vendor_id#PLANT#vendor_plant_id`
   - GSI2SK: `vendor_alert_id#TIMESTAMP`
   - **Query**: `GSI2PK = VENDOR#5#PLANT#STATION123 AND begins_with(GSI2SK, 'ALERT123#')`
3. **GSI3: `alert-id-index`** - Direct alert lookup (updates/deletes)
   - GSI3PK: `ALERT#alert_id`
   - GSI3SK: `PLANT#plant_id`
   - **Query**: `GSI3PK = ALERT#789`

**Note**: Status filtering (e.g., ACTIVE alerts) uses FilterExpression on GSI1 (plant-alert-index) queries, not a separate GSI.

**TTL**: `ttl` attribute (alert_time + 365 days)

**Why Separate**:
- **HIGH VOLUME** (1M alerts/month) - needs dedicated table for performance
- **TTL requirements** (365 days auto-cleanup)
- **Time-series characteristics** (sorted by timestamp)
- **Different access patterns** (plant queries, deduplication, status filtering)

---

#### Table 4: `work-order-plants` (Work Order Plant Mappings)

**Purpose**: Junction table for many-to-many relationship between Work Orders and Plants

**Work Order Hierarchy Context**:
- Work Orders belong to Organizations (org_id required in work_orders)
- Work Orders can optionally have a WMS Device assigned (wms_device_id in work_orders)
- Work Orders contain Plants from multiple Vendors (all within the same Organization)
- One active Work Order per Plant (enforced by unique constraint on plant_id where is_active=true)

**Production Metrics**:
- Work Order metrics are aggregated from all plants in the work order
- Organization metrics are aggregated from all plants in all work orders for that org
- No pre-aggregation needed - calculated on-the-fly from plant data

**Primary Key**:
- **PK**: `WORK_ORDER#work_order_id`
- **SK**: `PLANT#plant_id`

**GSI**:
1. **GSI1: `plant-workorder-index`** - Reverse lookup
   - GSI1PK: `PLANT#plant_id`
   - GSI1SK: `WORK_ORDER#work_order_id`
   - **Query**: `GSI1PK = PLANT#123` (get work orders for plant)

**Why Separate**: Junction pattern, simple structure

---

#### Table 5: `wms` (WMS Domain - Separate Domain)
**Purpose**: Weather Monitoring System (separate from solar plants)

**Entities**: WMS Vendors, WMS Sites, WMS Devices, Insolation Readings

**Primary Key**:
- **PK**: `ENTITY_TYPE` (STRING) - `WMS_VENDOR`, `WMS_SITE`, `WMS_DEVICE`, `INSULATION`
- **SK**: `ENTITY_ID` (STRING)

**GSIs**:
1. **GSI1: `wms-vendor-index`** - Query by WMS vendor
   - GSI1PK: `WMS_VENDOR#wms_vendor_id`
   - GSI1SK: `ENTITY_TYPE#ENTITY_ID`
2. **GSI2: `wms-site-index`** - Query devices by site
   - GSI2PK: `WMS_SITE#wms_site_id`
   - GSI2SK: `WMS_DEVICE#device_id`
3. **GSI3: `wms-org-index`** - Query by organization
   - GSI3PK: `ORG#org_id`
   - GSI3SK: `ENTITY_TYPE#ENTITY_ID`
4. **GSI4: `insolation-date-index`** - Query insolation by date
   - GSI4PK: `DATE#YYYY-MM-DD`
   - GSI4SK: `WMS_DEVICE#device_id`

**TTL**: For insolation readings (100 days)

**Why Separate**:
- **Separate domain** (weather monitoring vs solar plants)
- **Different access patterns** (sites, devices, insolation)
- **TTL requirements** (100 days for insolation)

---

## Comparison: Single-Table vs Multi-Table

### Single-Table Design (Original Proposal)
**Pros**:
- ✅ Fewer tables to manage
- ✅ Single table for all config entities

**Cons**:
- ❌ **Hot partition risk** with 7K plants in one table
- ❌ **Complex GSI management** (6 GSIs for mixed entities)
- ❌ **Inefficient for high-volume alerts** (1M/month mixed with config)
- ❌ **Poor separation of concerns** (alerts, plants, config all mixed)
- ❌ **Harder to optimize** (can't tune per table)
- ❌ **WMS mixed with solar plants** (different domains)

### Multi-Table Design (Recommended)
**Pros**:
- ✅ **Better performance** - Each table optimized for its access patterns
- ✅ **No hot partitions** - Plants (7K) in dedicated table
- ✅ **Clear separation** - Config, Plants, Alerts, WMS, Work-Order-Plants
- ✅ **Easier to scale** - Can tune each table independently
- ✅ **Better cost optimization** - On-demand billing per table
- ✅ **Domain separation** - WMS separate from solar plants
- ✅ **Simpler GSIs** - Each table has focused GSIs
- ✅ **Better maintainability** - Clear boundaries

**Cons**:
- ❌ More tables to manage (5 tables vs 3)
- ❌ Cross-table queries require multiple calls (but rare in this system)

---

## Cost Analysis (Multi-Table Design)

### Storage:
- **config**: ~1MB (low volume)
- **plants**: ~10MB (7K plants × ~1.5KB)
- **alerts**: ~500MB (1M alerts × ~500 bytes, with TTL)
- **work-order-plants**: ~1MB (low volume, ~100-500 work orders × 10-100 plants each)
- **wms**: ~5MB (low volume)
- **Total**: ~517MB (well within 25GB free tier)

### Read/Write Units:
- **Config**: 1K reads/day, 100 writes/day
- **Plants**: 10K reads/day, 1K writes/day (sync)
- **Alerts**: 35K reads/day (queries), 35K writes/day (sync)
- **Work-Order-Plants**: 500 reads/day, 100 writes/day
- **WMS**: 1K reads/day, 500 writes/day

**Total**: ~47K reads/day, ~37K writes/day = **1.4M reads/month, 1.1M writes/month**

**Cost**: Well within DynamoDB free tier (25 RCU, 25 WCU permanently free)

---

## Final Recommendation

### ✅ **Use Multi-Table Design**

**Rationale**:
1. **Plants deserve dedicated table** - Core entity (7K), multiple access patterns, rich attributes
2. **Alerts need separate table** - High volume (1M/month), TTL requirements, time-series
3. **WMS is separate domain** - Weather monitoring vs solar plants
4. **Better performance** - No hot partitions, optimized GSIs per table
5. **Easier maintenance** - Clear boundaries, simpler GSIs
6. **Cost-effective** - Still within free tier, better optimization per table
7. **Clear hierarchy** - Work Order → Org → Vendors → Plants relationship well-defined

### Table Summary:

| Table | Entities | GSIs | Purpose |
|-------|----------|------|---------|
| `config` | Accounts, Orgs, Vendors, Work Orders | 4 | Low-volume config (org-index, vendor-index, email-index, vendor-token-index). Work Orders include optional wms_device_id |
| `plants` | Plants (7K max, 3622 currently loaded) | 4 | Core entity, multiple patterns. Production metrics stored here |
| `alerts` | Alerts (1M/month) | 4 | High-volume time-series |
| `work-order-plants` | Work Order Plant Mappings | 1 | Many-to-many relationships (junction table) |
| `wms` | WMS Vendors, Sites, Devices, Insolation | 4 | Separate domain |

**Data Hierarchy**:
```
Work Order (assigned to Organization, org_id required)
  └── Organization
       ├── Vendors (20-50 max per org, org_id required)
       │    └── Plants (multiple per vendor, 7K total, org_id + vendor_id required)
       │         └── Alerts (multiple per plant, 35K/day, plant_id + vendor_id required)
       └── Work Orders (multiple per org, org_id required)
            └── Plants (via work-order-plants, from multiple vendors within same org)
```

**Key Constraints**:
- Work Orders must belong to an Organization (org_id required)
- Work Orders can optionally have a WMS Device assigned (wms_device_id, must belong to same org)
- Vendors must belong to an Organization (org_id required, 20-50 max per org)
- Plants must belong to an Organization and Vendor (org_id + vendor_id required)
- Work Orders can contain Plants from multiple Vendors (all within the same Organization)
- One active Work Order per Plant (enforced via work-order-plants table unique constraint)

**Production Metrics Aggregation**:
- **Plant Level**: Stored in `plants` table (current_power_kw, daily_energy_kwh, monthly_energy_mwh, yearly_energy_mwh, total_energy_mwh, capacity_kw)
- **Work Order Level**: Aggregated on-the-fly - Sum of all plant metrics in the work order
- **Organization Level**: Aggregated on-the-fly - Sum of all plants in all work orders for the org
- **Current Data**: 3622 plants loaded with production metrics

**Total**: 5 tables, 17 GSIs (well within DynamoDB limits: 4 + 4 + 4 + 1 + 4)

---

## Implementation Notes

1. **Plants table** - Most important, deserves 4 GSIs for optimal query performance
2. **Alerts table** - High volume, use TTL for auto-cleanup
3. **Config table** - Simple, low volume, 3 GSIs sufficient
4. **Work-Order-Plants table** - Simple, 1 GSI for reverse lookup
5. **WMS table** - Separate domain, 4 GSIs for WMS-specific queries

This design follows DynamoDB best practices:
- ✅ One table per access pattern group
- ✅ GSIs optimized for actual query patterns
- ✅ TTL for time-series data
- ✅ Partition key distribution (alerts by plant_id)
- ✅ Clear domain boundaries
- ✅ Production metrics stored at plant level, aggregated on-the-fly
- ✅ Work Order WMS device association supported
- ✅ Proper naming: `work-order-plants` instead of generic "junctions"

