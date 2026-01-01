# Erooka - Architecture Design Document

## Project Overview

**Erooka** is a serverless solar work order mapping system built with AWS serverless technologies and DynamoDB. The system manages solar plants, vendors, alerts, work orders, and WMS (Weather Monitoring System) data.

**Data Hierarchy**: Work Order → Organization → Vendors → Plants → Alerts
- Work Orders are assigned to Organizations (org_id required)
- Organizations have multiple Vendors (20-50 max per org)
- Each Vendor has multiple Plants (7K total)
- Work Orders can contain Plants from multiple Vendors within the same Organization
- Plants generate Alerts (35K alerts/day)

## System Scale & Requirements

- **Plants**: Maximum 7,000 plants
- **Alerts**: ~5 alerts/day per plant = ~35,000 alerts/day = ~1M alerts/month
- **Concurrent Users**: Maximum 30 users
- **Long-running Tasks**: Maximum 2 minutes (sync jobs)
- **Test Coverage**: >90% (integration tests)
- **Architecture**: 100% Serverless (Lambda, API Gateway, DynamoDB, EventBridge)

## Cost Optimization Strategy

### Current Scale Analysis
- **Read Operations**: ~30 users × 100 requests/day = 3,000 reads/day = 90K/month
- **Write Operations**: ~35K alerts/day + sync operations = ~1.1M writes/month
- **Storage**: ~7K plants + 1M alerts/month = ~50GB/year (with TTL)

### Cost-Effective Design Decisions

1. **DynamoDB On-Demand Billing**: Pay-per-request (no capacity planning needed)
   - Free tier: 25GB storage, 25 RCU, 25 WCU permanently free
   - Estimated cost: ~$5-10/month (well within free tier for this scale)

2. **Lambda**: 
   - Free tier: 1M requests/month, 400K GB-seconds
   - Estimated cost: ~$2-5/month

3. **API Gateway**:
   - Free tier: 1M requests/month
   - Estimated cost: $0 (within free tier)

4. **EventBridge**:
   - Free tier: 14M custom events/month
   - Estimated cost: $0 (within free tier)

5. **Frontend**: **Cloudflare Pages** (Recommended - FREE, unlimited bandwidth)
   - Alternative: Vercel ($20/month) or AWS S3+CloudFront (~$5/month)
   - **Recommendation**: Cloudflare Pages for zero cost

**Total Estimated Monthly Cost: $5-15/month** (mostly within free tiers)

## DynamoDB Schema Design

> **⚠️ IMPORTANT**: After analyzing the WOMS SQL schema and access patterns, we've updated the design to use **MULTI-TABLE** architecture. See [DYNAMODB_SCHEMA_ANALYSIS.md](./DYNAMODB_SCHEMA_ANALYSIS.md) for detailed analysis.

### Table 1: `config` (Configuration Entities)

**Purpose**: Stores low-volume configuration entities (accounts, organizations, vendors, work orders)

**Primary Key Structure**:
- **PK**: `ENTITY_TYPE` (STRING) - Values: `ACCOUNT`, `ORG`, `VENDOR`, `WORK_ORDER`
- **SK**: `ENTITY_ID` (STRING) - UUID for accounts, numeric ID as string for others

**Global Secondary Indexes (GSIs)**:

#### GSI1: `org-index` (Query by Organization)
- **GSI1PK**: `ORG#org_id` (STRING) - e.g., `ORG#1`
- **GSI1SK**: `ENTITY_TYPE#ENTITY_ID` (STRING) - e.g., `PLANT#123`, `VENDOR#5`
- **Purpose**: Query all entities (plants, vendors, work orders) for an organization
- **Query Pattern**: `GSI1PK = ORG#1 AND begins_with(GSI1SK, 'PLANT#')`

#### GSI2: `vendor-index` (Query by Vendor)
- **GSI2PK**: `VENDOR#vendor_id` (STRING) - e.g., `VENDOR#5`
- **GSI2SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Query all plants for a vendor
- **Query Pattern**: `GSI2PK = VENDOR#5`

#### GSI3: `email-index` (Account Lookup by Email)
- **GSI3PK**: `EMAIL#email` (STRING) - e.g., `EMAIL#admin@erooka.com`
- **GSI3SK**: `ACCOUNT#account_id` (STRING) - e.g., `ACCOUNT#uuid`
- **Purpose**: Fast account lookup for login (most common query)
- **Query Pattern**: `GSI3PK = EMAIL#admin@erooka.com`

#### GSI4: `vendor-token-index` (Token Refresh)
- **GSI4PK**: `VENDOR#vendor_id` (STRING) - e.g., `VENDOR#5`
- **GSI4SK**: `TOKEN#expires_at` (STRING) - e.g., `TOKEN#2025-01-15T10:00:00Z`
- **Purpose**: Query vendors with expired tokens for refresh
- **Query Pattern**: `GSI4PK = VENDOR#5` (with filter on expires_at)

**Item Examples**:

```json
// Organization
{
  "PK": "ORG",
  "SK": "1",
  "name": "Solar Energy Corp",
  "auto_sync_enabled": true,
  "sync_interval_minutes": 15,
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}

// Vendor
{
  "PK": "VENDOR",
  "SK": "5",
  "GSI1PK": "ORG#1",
  "GSI1SK": "VENDOR#5",
  "GSI2PK": "VENDOR#5",
  "GSI2SK": "VENDOR#5", // Self-reference for vendor queries
  "name": "Solarman",
  "vendor_type": "SOLARMAN",
  "credentials": { "appId": "...", "appSecret": "..." },
  "org_id": 1,
  "is_active": true,
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}

// Note: Plants are now in a separate table (plants) - see Table 2 below

// Account
{
  "PK": "ACCOUNT",
  "SK": "d816d896-b60b-4e24-884c-785926d6c2c0",
  "GSI1PK": "ORG#1", // nullable for SUPERADMIN/GOVT
  "GSI1SK": "ACCOUNT#d816d896-b60b-4e24-884c-785926d6c2c0",
  "GSI3PK": "EMAIL#admin@erooka.com",
  "GSI3SK": "ACCOUNT#d816d896-b60b-4e24-884c-785926d6c2c0",
  "account_type": "SUPERADMIN",
  "email": "admin@erooka.com",
  "password_hash": "$2b$10$...",
  "org_id": null, // null for SUPERADMIN/GOVT
  "display_name": "Admin User",
  "is_active": true,
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

### Table 2: `plants` (Plants - Core Entity)

**Hierarchy**: Work Order → Organization → Vendors → Plants
- Work Orders are assigned to Organizations
- Organizations have multiple Vendors
- Each Vendor has multiple Plants
- Work Orders can contain Plants from multiple Vendors within the same Organization

**Purpose**: Core entity with multiple access patterns (7,000 plants max)

**Primary Key Structure**:
- **PK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **SK**: `PLANT#plant_id` (STRING) - Same as PK for direct lookup

**⚠️ CRITICAL**: Plant ID as partition key ensures **perfect distribution** across 7,000 partitions, eliminating hot partition risk for high-frequency writes (every 15 minutes).

**Global Secondary Indexes (GSIs)**:

#### GSI1: `org-index` (Query by Organization - MOST COMMON)
- **GSI1PK**: `ORG#org_id` (STRING) - e.g., `ORG#1`
- **GSI1SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Query all plants for an organization (most common query)
- **Query Pattern**: `GSI1PK = ORG#1`

#### GSI2: `vendor-index` (Query by Vendor)
- **GSI2PK**: `VENDOR#vendor_id` (STRING) - e.g., `VENDOR#5`
- **GSI2SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Query all plants for a vendor
- **Query Pattern**: `GSI2PK = VENDOR#5`

#### GSI3: `vendor-plant-unique-index` (Unique Constraint)
- **GSI3PK**: `VENDOR#vendor_id#PLANT#vendor_plant_id` (STRING) - e.g., `VENDOR#5#PLANT#STATION123`
- **GSI3SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Enforce unique constraint (vendor_id, vendor_plant_id) and fast lookup
- **Query Pattern**: `GSI3PK = VENDOR#5#PLANT#STATION123` (exact match for uniqueness check)

#### GSI4: `status-index` (Query by Network Status)
- **GSI4PK**: `STATUS#network_status` (STRING) - e.g., `STATUS#NORMAL`
- **GSI4SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Query plants by network status
- **Query Pattern**: `GSI4PK = STATUS#NORMAL`

**Item Example**:
```json
{
  "PK": "PLANT#123",
  "SK": "PLANT#123",
  "GSI1PK": "ORG#1",
  "GSI1SK": "PLANT#123",
  "GSI2PK": "VENDOR#5",
  "GSI2SK": "PLANT#123",
  "GSI3PK": "VENDOR#5#PLANT#STATION123",
  "GSI3SK": "PLANT#123",
  "GSI4PK": "STATUS#NORMAL",
  "GSI4SK": "PLANT#123",
  "org_id": 1,
  "vendor_id": 5,
  "vendor_plant_id": "STATION123",
  "name": "Solar Farm Alpha",
  "capacity_kw": 1000.0,
  "location": {
    "lat": 28.6139,
    "lng": 77.2090,
    "address": "Delhi, India"
  },
  "current_power_kw": 125.5,
  "daily_energy_kwh": 2500.0,
  "monthly_energy_mwh": 750.0,
  "yearly_energy_mwh": 9000.0,
  "total_energy_mwh": 10000.0,
  "network_status": "NORMAL",
  "is_active": true,
  "was_online_today": true,
  "last_update_time": "2025-01-15T10:00:00Z",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

### Table 3: `alerts` (Alerts - High Volume Time-Series)

**Purpose**: Stores alerts and time-series data with TTL for auto-cleanup

**Primary Key Structure**:
- **PK**: `ENTITY_TYPE#ENTITY_ID` (STRING)
  - For Alerts: `PLANT#plant_id` (distributes across partitions)
  - For Insolation: `WMS_DEVICE#device_id`
- **SK**: `TIMESTAMP#UNIQUE_ID` (STRING)
  - For Alerts: `2025-01-15T14:30:00Z#789` (alert_time#alert_id)
  - For Insolation: `2025-01-15` (reading_date)

**Global Secondary Indexes**:

#### GSI1: `date-index` (Query by Date)
- **GSI1PK**: `DATE#YYYY-MM-DD` (STRING) - e.g., `DATE#2025-01-15`
- **GSI1SK**: `ENTITY_TYPE#ENTITY_ID` (STRING) - e.g., `PLANT#123`, `WMS_DEVICE#456`
- **Purpose**: Query all alerts/readings for a specific date across all entities
- **Query Pattern**: `GSI1PK = DATE#2025-01-15 AND begins_with(GSI1SK, 'PLANT#')`

#### GSI2: `plant-alert-index` (Query Alerts by Plant)
- **GSI2PK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **GSI2SK**: `TIMESTAMP#alert_id` (STRING) - e.g., `2025-01-15T14:30:00Z#789`
- **Purpose**: Query all alerts for a plant, sorted by timestamp descending (most common query)
- **Query Pattern**: `GSI2PK = PLANT#123` with `ScanIndexForward: false`

#### GSI3: `vendor-alert-index` (Deduplication)
- **GSI3PK**: `VENDOR#vendor_id#PLANT#vendor_plant_id` (STRING) - e.g., `VENDOR#5#PLANT#STATION123`
- **GSI3SK**: `vendor_alert_id#TIMESTAMP` (STRING) - e.g., `ALERT123#2025-01-15T14:30:00Z`
- **Purpose**: Deduplicate alerts by (vendor_id, vendor_alert_id, plant_id)
- **Query Pattern**: `GSI3PK = VENDOR#5#PLANT#STATION123 AND begins_with(GSI3SK, 'ALERT123#')`

#### GSI4: `alert-id-index` (Direct Alert Lookup)
- **GSI4PK**: `ALERT#alert_id` (STRING) - e.g., `ALERT#789`
- **GSI4SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Direct lookup of alert by ID (for updates/deletes)
- **Query Pattern**: `GSI4PK = ALERT#789`

**Note**: Status filtering (e.g., ACTIVE alerts) uses FilterExpression on GSI2 (plant-alert-index) queries. No separate status-index GSI needed.

**TTL Attribute**: `ttl` (NUMBER, Unix timestamp in seconds)
- **Alerts**: TTL = alert_time + 180 days (6 months retention)
- **Insolation Readings**: TTL = reading_date + 100 days

**Item Examples**:

```json
// Alert
{
  "PK": "PLANT#123",
  "SK": "2025-01-15T14:30:00Z#789",
  "GSI1PK": "DATE#2025-01-15",
  "GSI1SK": "PLANT#123",
  "GSI2PK": "PLANT#123",
  "GSI2SK": "2025-01-15T14:30:00Z#789",
  "GSI3PK": "VENDOR#5#PLANT#STATION123",
  "GSI3SK": "ALERT123#2025-01-15T14:30:00Z",
  "GSI4PK": "ALERT#789",
  "GSI4SK": "PLANT#123",
  "ttl": 1736359800, // alert_time + 180 days (6 months)
  "id": 789,
  "plant_id": 123,
  "vendor_id": 5,
  "vendor_alert_id": "ALERT123",
  "vendor_plant_id": "STATION123",
  "alert_time": "2025-01-15T14:30:00Z",
  "end_time": "2025-01-15T15:00:00Z",
  "title": "Inverter Fault",
  "description": "Inverter communication lost",
  "severity": "HIGH",
  "status": "ACTIVE",
  "grid_down_seconds": 1800,
  "grid_down_benefit_kwh": 250.5,
  "created_at": "2025-01-15T14:30:00Z",
  "updated_at": "2025-01-15T14:30:00Z"
}
```

### Table 4: `work-order-plants` (Work Order Plant Mappings)

**Purpose**: Stores many-to-many relationships between Work Orders and Plants

**Hierarchy Context**:
- Work Orders belong to Organizations (org_id required in work_orders)
- Work Orders contain Plants from multiple Vendors (all within the same Organization)
- One active Work Order per Plant (enforced by unique constraint on plant_id where is_active=true)
- Work Orders can optionally have a WMS Device assigned (wms_device_id in work_orders table)

**Production Metrics Aggregation**:
- **Work Order Level**: Sum of all plant metrics (current_power_kw, daily_energy_kwh, monthly_energy_mwh, yearly_energy_mwh, total_energy_mwh, capacity_kw)
- **Organization Level**: Sum of all plants in all work orders for that organization
- Metrics calculated on-the-fly from plant data (no pre-aggregation needed)

**Primary Key Structure**:
- **PK**: `WORK_ORDER#work_order_id` (STRING) - e.g., `WORK_ORDER#100`
- **SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`

**Global Secondary Index**:

#### GSI1: `plant-workorder-index` (Reverse Lookup)
- **GSI1PK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **GSI1SK**: `WORK_ORDER#work_order_id` (STRING) - e.g., `WORK_ORDER#100`
- **Purpose**: Query all work orders for a plant (reverse lookup), enforce one active work order per plant
- **Query Pattern**: `GSI1PK = PLANT#123` (filter by is_active=true in application layer)

**Item Example**:

```json
// Work Order Plant Mapping
{
  "PK": "WORK_ORDER#100",
  "SK": "PLANT#123",
  "GSI1PK": "PLANT#123",
  "GSI1SK": "WORK_ORDER#100",
  "work_order_id": 100,
  "plant_id": 123,
  "is_active": true,
  "added_at": "2025-01-15T10:00:00Z"
}
```

**Note**: Work Orders also have optional `wms_device_id` field (stored in `config` table with work order entity) for WMS device association.

### Table 5: `wms` (WMS Domain - Separate Domain)

**Purpose**: Weather Monitoring System (separate from solar plants)

**Note**: WMS is independent of the Work Order → Org → Vendors → Plants hierarchy

**Entities**: WMS Vendors, WMS Sites, WMS Devices, Insolation Readings

**Primary Key Structure**:
- **PK**: `ENTITY_TYPE` (STRING) - Values: `WMS_VENDOR`, `WMS_SITE`, `WMS_DEVICE`, `INSULATION`
- **SK**: `ENTITY_ID` (STRING)

**Global Secondary Indexes (GSIs)**:

#### GSI1: `wms-vendor-index` (Query by WMS Vendor)
- **GSI1PK**: `WMS_VENDOR#wms_vendor_id` (STRING) - e.g., `WMS_VENDOR#10`
- **GSI1SK**: `ENTITY_TYPE#ENTITY_ID` (STRING) - e.g., `WMS_SITE#789`, `WMS_DEVICE#456`
- **Purpose**: Query all sites/devices for a WMS vendor
- **Query Pattern**: `GSI1PK = WMS_VENDOR#10 AND begins_with(GSI1SK, 'WMS_SITE#')`

#### GSI2: `wms-site-index` (Query Devices by Site)
- **GSI2PK**: `WMS_SITE#wms_site_id` (STRING) - e.g., `WMS_SITE#789`
- **GSI2SK**: `WMS_DEVICE#device_id` (STRING) - e.g., `WMS_DEVICE#456`
- **Purpose**: Query all devices for a WMS site
- **Query Pattern**: `GSI2PK = WMS_SITE#789`

#### GSI3: `wms-org-index` (Query by Organization)
- **GSI3PK**: `ORG#org_id` (STRING) - e.g., `ORG#1`
- **GSI3SK**: `ENTITY_TYPE#ENTITY_ID` (STRING) - e.g., `WMS_SITE#789`
- **Purpose**: Query all WMS entities for an organization
- **Query Pattern**: `GSI3PK = ORG#1 AND begins_with(GSI3SK, 'WMS_SITE#')`

#### GSI4: `insolation-date-index` (Query Insolation by Date)
- **GSI4PK**: `DATE#YYYY-MM-DD` (STRING) - e.g., `DATE#2025-01-15`
- **GSI4SK**: `WMS_DEVICE#device_id` (STRING) - e.g., `WMS_DEVICE#456`
- **Purpose**: Query insolation readings for a specific date
- **Query Pattern**: `GSI4PK = DATE#2025-01-15`

**TTL Attribute**: `ttl` (NUMBER, Unix timestamp in seconds)
- **Insolation Readings**: TTL = reading_date + 100 days

**Item Examples**:
```json
// WMS Vendor
{
  "PK": "WMS_VENDOR",
  "SK": "10",
  "GSI3PK": "ORG#1",
  "GSI3SK": "WMS_VENDOR#10",
  "name": "Intello",
  "vendor_type": "INTELLO",
  "credentials": { "email": "...", "password_hash": "..." },
  "org_id": 1,
  "is_active": true,
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}

// Insolation Reading
{
  "PK": "INSULATION",
  "SK": "456#2025-01-15",
  "GSI4PK": "DATE#2025-01-15",
  "GSI4SK": "WMS_DEVICE#456",
  "ttl": 1736359800, // reading_date + 100 days
  "wms_device_id": 456,
  "reading_date": "2025-01-15",
  "insolation_value": 850.5,
  "reading_count": 24,
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

## Summary: Multi-Table Design

**Total Tables**: 5
- `config` - Configuration entities (4 GSIs: org-index, vendor-index, email-index, vendor-token-index)
  - Entities: Accounts, Organizations, Vendors, Work Orders (with optional wms_device_id)
- `plants` - Core entity, 7K plants (4 GSIs)
  - Production metrics: current_power_kw, daily_energy_kwh, monthly_energy_mwh, yearly_energy_mwh, total_energy_mwh, capacity_kw
- `alerts` - High volume time-series, 1M/month (4 GSIs)
- `work-order-plants` - Work Order to Plant mappings (1 GSI)
  - Junction table for many-to-many relationship (Work Order ↔ Plant)
  - Enforces one active work order per plant
- `wms` - WMS domain (4 GSIs)

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

**Production Metrics Aggregation Strategy**:
- **Plant Level**: Stored directly in `plants` table (updated every 15 minutes)
- **Work Order Level**: Aggregated on-the-fly by summing all plant metrics in the work order
  - Query: Get all plants via `work-order-plants` table, sum their metrics
  - Metrics: installedCapacityKw, currentPowerKw, dailyEnergyKwh, monthlyEnergyMwh, yearlyEnergyMwh, totalEnergyMwh
- **Organization Level**: Aggregated on-the-fly by summing all plants in all work orders for the org
  - Query: Get all work orders for org → Get all plants in those work orders → Sum metrics
  - Same metrics as work order level
- **Dashboard Level (SUPERADMIN/GOVT/ORG)**: Aggregated on-the-fly by summing all plants mapped to work orders
  - **Key Principle**: Dashboard metrics include **only plants mapped to work orders** (not all plants)
  - SUPERADMIN/GOVT: All work orders across all organizations
  - ORG: Work orders for the organization only
  - Metrics: totalEnergyMwh, dailyEnergyMwh, monthlyEnergyMwh, yearlyEnergyMwh, currentPowerKw, installedCapacityKw
- **No Pre-aggregation**: Metrics calculated dynamically (plants table is source of truth)

**Total GSIs**: 17 (well within DynamoDB limits: 4 + 4 + 4 + 1 + 4)

**Why Multi-Table?**
- ✅ Better performance (no hot partitions)
- ✅ Plants (core entity) in dedicated table
- ✅ Alerts (high volume) in separate table
- ✅ WMS (separate domain) isolated
- ✅ Easier to optimize and maintain
- ✅ Still cost-effective (within free tier)

See [DYNAMODB_SCHEMA_ANALYSIS.md](./DYNAMODB_SCHEMA_ANALYSIS.md) for detailed analysis.  
See [DATA_HIERARCHY.md](./DATA_HIERARCHY.md) for complete hierarchy and relationship documentation.  
See [PRODUCTION_METRICS_DESIGN.md](./PRODUCTION_METRICS_DESIGN.md) for production metrics aggregation strategy.  
See [DASHBOARD_METRICS_DESIGN.md](./DASHBOARD_METRICS_DESIGN.md) for dashboard-level metrics aggregation (SUPERADMIN/GOVT/ORG).  
See [API_PSEUDOCODE.md](./API_PSEUDOCODE.md) for complete API pseudo-code and DynamoDB query patterns.  
See [INDEX_VERIFICATION.md](./INDEX_VERIFICATION.md) for verification that all WOMS SQL indexes are correctly mapped to DynamoDB GSIs.

## Serverless Architecture

### API Layer

**API Gateway REST API** with the following structure:
- `/api/login` - Authentication (POST login, GET /api/me)
- `/api/accounts/*` - Account management (CRUD - SUPERADMIN only)
- `/api/orgs/*` - Organization management (CRUD, plants, production)
- `/api/vendors/*` - Vendor management (CRUD, sync-plants, sync-alerts, sync-status)
- `/api/plants/*` - Plant management (CRUD, production, telemetry, unassigned)
- `/api/alerts/*` - Alert management (list with filtering)
- `/api/workorders/*` - Work order management (CRUD, plants, production)
- `/api/dashboard` - Dashboard data (role-specific metrics: SUPERADMIN/GOVT/ORG)
- `/api/wms/*` - WMS management (vendors, sites, devices, insolation)

**Complete API pseudo-code and query patterns**: See [API_PSEUDOCODE.md](./API_PSEUDOCODE.md)

**Lambda Functions** (Grouped by Domain):
- `auth-handler` - Authentication (login, session validation)
- `orgs-handler` - Organization CRUD
- `vendors-handler` - Vendor CRUD + sync
- `plants-handler` - Plant CRUD + queries
- `alerts-handler` - Alert queries + updates
- `workorders-handler` - Work order CRUD (assigned to Organizations)
- `wms-handler` - WMS CRUD + sync
- `dashboard-handler` - Dashboard aggregation

### Background Jobs (EventBridge)

**EventBridge Rules** for scheduled tasks:
- `plant-sync` - Plant sync every 15 minutes (5 AM - 8 PM working window)
- `alert-sync` - Alert sync every 30 minutes
- `telemetry-sync` - Telemetry sync every 15 minutes
- `wms-site-sync` - WMS site sync daily
- `wms-insolation-sync` - WMS insolation sync daily
- `disable-plants` - Disable inactive plants daily

**Lambda Functions** for background jobs:
- `sync-plants` - Plant synchronization (7K plants, every 15 minutes)
- `sync-alerts` - Alert synchronization
- `sync-telemetry` - Telemetry synchronization
- `sync-wms-sites` - WMS site synchronization
- `sync-wms-insolation` - WMS insolation synchronization
- `disable-inactive-plants` - Plant status management

### Lambda Configuration

- **Runtime**: Node.js 20.x
- **Memory**: 512 MB (default), 1024 MB for sync jobs
- **Timeout**: 30 seconds (API handlers), 2 minutes (sync jobs)
- **Layers**: Shared code layer (vendor adapters, services, utilities)

## Code Structure (SOLID Principles)

```
erooka/
├── infrastructure/          # Terraform IaC
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── dynamodb.tf
│   ├── lambda.tf
│   ├── api-gateway.tf
│   └── eventbridge.tf
│
├── src/                     # Source code
│   ├── domain/              # Domain models (entities, value objects)
│   │   ├── account/
│   │   ├── organization/
│   │   ├── vendor/
│   │   ├── plant/
│   │   ├── alert/
│   │   ├── workorder/
│   │   └── wms/
│   │
│   ├── application/         # Application services (use cases)
│   │   ├── auth/
│   │   ├── organization/
│   │   ├── vendor/
│   │   ├── plant/
│   │   ├── alert/
│   │   ├── workorder/
│   │   └── wms/
│   │
│   ├── infrastructure/      # Infrastructure layer
│   │   ├── dynamodb/        # DynamoDB repositories
│   │   │   ├── repositories/
│   │   │   └── client.ts
│   │   ├── vendors/          # Vendor adapters
│   │   │   ├── base/
│   │   │   ├── solarman/
│   │   │   └── manager.ts
│   │   └── logging/         # Logging utilities
│   │
│   ├── interfaces/          # Interface adapters
│   │   ├── api/             # API Gateway handlers
│   │   │   ├── auth/
│   │   │   ├── orgs/
│   │   │   ├── vendors/
│   │   │   ├── plants/
│   │   │   ├── alerts/
│   │   │   ├── workorders/
│   │   │   ├── wms/
│   │   │   └── dashboard/
│   │   └── events/           # EventBridge handlers
│   │       ├── sync-plants/
│   │       ├── sync-alerts/
│   │       ├── sync-telemetry/
│   │       └── sync-wms/
│   │
│   └── shared/              # Shared utilities
│       ├── errors/
│       ├── validation/
│       └── types/
│
├── tests/                   # Test suite
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests (DynamoDB Local)
│   ├── e2e/                 # E2E tests
│   └── features/            # Cucumber feature files
│       ├── authentication.feature
│       ├── plants.feature
│       ├── alerts.feature
│       └── workorders.feature
│
├── frontend/                # Next.js frontend
│   ├── app/
│   ├── components/
│   ├── lib/
│   └── public/
│
└── docs/                    # Documentation
    ├── API.md
    └── DEPLOYMENT.md
```

## Testing Strategy (TDD + Cucumber)

### Test Structure

1. **Unit Tests**: Test domain models, services, repositories in isolation
2. **Integration Tests**: Test DynamoDB operations with DynamoDB Local
3. **E2E Tests**: Test complete flows (API Gateway → Lambda → DynamoDB)
4. **Cucumber Tests**: BDD scenarios for critical business flows

### Test Coverage Target: >90%

### Cucumber Feature Files

- `authentication.feature` - Login, session management
- `plants.feature` - Plant CRUD, sync, queries
- `alerts.feature` - Alert sync, queries, updates
- `workorders.feature` - Work order creation, plant assignment
- `vendors.feature` - Vendor management, sync
- `wms.feature` - WMS sync, insolation readings

## Frontend Architecture

### Technology Stack

- **Framework**: Next.js 14+ (App Router)
- **Styling**: TailwindCSS
- **Components**: shadcn/ui (Radix UI)
- **Animations**: Framer Motion (full animations everywhere)
- **Charts**: Recharts
- **State**: React Context + Hooks

### Deployment

**Recommended**: **Cloudflare Pages** (FREE, unlimited bandwidth)
- Zero cost
- Automatic CI/CD
- Global CDN
- Excellent performance

**Alternative**: AWS S3 + CloudFront (~$5/month)

## Security

1. **Authentication**: HTTP-only cookies with base64-encoded session
2. **Authorization**: RBAC (Role-Based Access Control)
3. **Secrets**: AWS Secrets Manager for vendor credentials
4. **Encryption**: DynamoDB encryption at rest (default)
5. **API Security**: API Gateway throttling, CORS configuration

## Monitoring & Observability

1. **Logging**: CloudWatch Logs (structured JSON logging)
2. **Metrics**: CloudWatch Metrics (custom metrics for business KPIs)
3. **Tracing**: AWS X-Ray (optional, for debugging)
4. **Alarms**: CloudWatch Alarms for errors and high latency

## Cost Breakdown (Monthly) - UPDATED

### Write Volume Analysis
- **Plant updates**: 7,000 plants × 60 intervals/day × 30 days = **12.6M writes/month**
- **Alert writes**: ~1.1M writes/month
- **Config writes**: ~100K writes/month
- **Total writes**: ~13.8M writes/month ✅ (within 64.8M free tier)

| Service | Usage | Cost |
|---------|-------|------|
| DynamoDB | ~517MB storage, 1.4M reads, 13.8M writes | $0-5 (free tier) |
| Lambda | 100K invocations, 200K GB-seconds | $0-2 (free tier) |
| API Gateway | 3M requests | $0 (free tier) |
| EventBridge | 1M custom events | $0 (free tier) |
| CloudWatch | Logs + Metrics | $0-3 |
| Cloudflare Pages | Unlimited | $0 |
| **Total** | | **$5-15/month** |

**Note**: High-frequency plant writes (every 15 minutes) are handled efficiently with batch writes and perfect partition distribution (plant_id as PK).

## DynamoDB Query Optimization

Based on analysis of all API patterns from WOMS, the following optimizations are implemented:

### 1. Batch Operations

**BatchGetItem** for reading multiple items:
- Dashboard: BatchGetItem for plants (25 items per batch, ~120-200 batches for 3K plants)
- Work Order Production: BatchGetItem for plants in work order
- Vendor Sync: BatchGetItem for existing plants before upsert

**BatchWriteItem** for writing multiple items:
- Plant Sync: BatchWriteItem for plant updates (25 items per batch, ~280 batches for 7K plants)
- Work Order Plants: BatchWriteItem for mappings

### 2. Query vs Scan

**Always use Query when possible**:
- ✅ Login: Query email-index (GSI3) - not Scan
- ✅ Org queries: Query org-index (GSI1) - not Scan
- ✅ Plant queries: Query vendor-index (GSI2) or org-index (GSI1) - not Scan
- ✅ Alert queries: Query plant-alert-index (GSI2) - not Scan
- ⚠️ Only Scan when no index available (e.g., listing all work orders for SUPERADMIN)

### 3. GSI Design Rationale

**org-index (GSI1)**:
- Query pattern: `GSI1PK = ORG#{orgId}` with `begins_with(GSI1SK, 'ENTITY_TYPE#')`
- Supports: Get all vendors, plants, work orders for an organization
- Critical for RBAC filtering (ORG users)

**plant-alert-index (GSI2 in alerts table)**:
- Query pattern: `GSI2PK = PLANT#{plantId}`
- MOST COMMON query (35K alerts/day)
- Enables efficient alert fetching per plant

**email-index (GSI3 in config table)**:
- Query pattern: `GSI3PK = EMAIL#{email}`
- Critical path for login (must be fast)
- Single-item query (perfect for login)

### 4. Filtering Strategy

**Filter in Query when possible**:
- Work Order Plants: Query with `FilterExpression: is_active = true`
- Alerts: Query with `FilterExpression: status = ACTIVE`
- Avoid filtering large result sets in application layer

**Partition Key Distribution**:
- Plants: PK = `PLANT#{plant_id}` (perfect distribution for 7K plants)
- Alerts: PK = `PLANT#{plant_id}` (distributed by plant, prevents hot partitions)
- Config: PK = `ENTITY_TYPE` (low volume, acceptable)

### 5. Parallel Queries

**Use Promise.all for independent queries**:
- Dashboard: Parallel queries for work orders, plants, alerts counts
- Work Order Production: Parallel BatchGetItem batches (up to 15 concurrent)
- Vendor Sync: Parallel vendor API calls (up to 10 concurrent)

### 6. Query Performance Estimates

| Query Type | Items | Batches | Est. Latency |
|------------|-------|---------|--------------|
| Login | 1 | 1 | <10ms |
| Dashboard (SUPERADMIN) | ~3000 plants | ~120 | ~500ms |
| Work Order Production | ~50 plants | ~2 | ~50ms |
| Org Production | ~500 plants | ~20 | ~200ms |
| Plant Sync | 7000 plants | 280 | ~15s (parallel batches) |
| Alert Query (per plant) | ~100 alerts | 1 | <20ms |

**Complete API pseudo-code and query patterns**: See [API_PSEUDOCODE.md](./API_PSEUDOCODE.md)

## Next Steps

1. ✅ Create project structure
2. ✅ Design DynamoDB schema
3. ✅ Enrich architecture with API pseudo-code and query optimization
4. ⏭️ Set up Terraform infrastructure
5. ⏭️ Implement authentication (TDD)
6. ⏭️ Implement domains one by one
7. ⏭️ Build animated frontend
8. ⏭️ Deploy and test

1. ✅ Create project structure
2. ✅ Design DynamoDB schema
3. ⏭️ Set up Terraform infrastructure
4. ⏭️ Implement authentication (TDD)
5. ⏭️ Implement domains one by one
6. ⏭️ Build animated frontend
7. ⏭️ Deploy and test

