# Production Metrics Design

## Overview

Production metrics are stored at the **Plant level** and aggregated on-the-fly at Work Order and Organization levels. No pre-aggregation is needed - the `plants` table is the single source of truth.

## Current Data Status

- **Plants Loaded**: 3,622 plants (out of 7,000 max capacity)
- **Production Data**: Complete for loaded plants
- **Update Frequency**: Every 15 minutes (5 AM - 8 PM working window)

## Metrics Structure

### Plant Level Metrics (Stored in `plants` table)

**Attributes** (updated every 15 minutes):
- `capacity_kw` - Installed Capacity (kWp)
- `current_power_kw` - Current Power (kW)
- `daily_energy_kwh` - Daily Energy (kWh) - stored in kWh to avoid rounding errors
- `monthly_energy_mwh` - Monthly Energy (MWh)
- `yearly_energy_mwh` - Yearly Energy (MWh)
- `total_energy_mwh` - Total Cumulative Energy (MWh)
- `is_online` - Online status (was_online_today)
- `last_update_time` - Last time production data was updated from vendor
- `last_refreshed_at` - Last time plant data was refreshed in database

**Storage**: Directly in `plants` table, updated via batch writes every 15 minutes

### Work Order Level Metrics (Aggregated On-the-Fly)

**Calculation**: Sum of all plant metrics in the work order

**Query Pattern**:
1. Query `work-order-plants` table: `PK = WORK_ORDER#work_order_id`
2. Extract all `plant_id` values
3. Query `plants` table: BatchGetItem for all plant_ids
4. Sum metrics:
   - `installedCapacityKw = sum(plants.capacity_kw)`
   - `currentPowerKw = sum(plants.current_power_kw)`
   - `dailyEnergyKwh = sum(plants.daily_energy_kwh)`
   - `monthlyEnergyMwh = sum(plants.monthly_energy_mwh)`
   - `yearlyEnergyMwh = sum(plants.yearly_energy_mwh)`
   - `totalEnergyMwh = sum(plants.total_energy_mwh)`

**Performance**: 
- Work orders typically have 10-100 plants
- BatchGetItem for plants is efficient (25 items per batch)
- No pre-aggregation needed

### Organization Level Metrics (Aggregated On-the-Fly)

**Calculation**: Sum of all plants in all work orders for the organization

**Query Pattern**:
1. Query `config` table: `GSI1PK = ORG#org_id AND begins_with(GSI1SK, 'WORK_ORDER#')` (get all work orders for org)
2. Extract all `work_order_id` values
3. Query `work-order-plants` table: BatchGetItem for all work orders
4. Extract all unique `plant_id` values
5. Query `plants` table: BatchGetItem for all plant_ids
6. Sum metrics (same as work order level)

**Performance**:
- Organizations typically have 5-20 work orders
- Each work order has 10-100 plants
- Total: ~50-2000 plants per organization
- BatchGetItem handles this efficiently

## Dashboard-Level Aggregation

### GET /api/dashboard

**Purpose**: Get dashboard metrics based on user role

**Key Principle**: Dashboard metrics aggregate from **plants mapped to work orders only** (not all plants)

#### SUPERADMIN/DEVELOPER Dashboard
- **Scope**: All work orders across all organizations
- **Query Pattern**:
  1. Get all work orders: Query `config` table for all `WORK_ORDER` entities
  2. Get all active plants in work orders: Query `work-order-plants` table for all work orders, filter `is_active = true`
  3. Extract unique `plant_id` values
  4. Query `plants` table: BatchGetItem for all plant_ids
  5. Sum metrics from all mapped plants:
     - `totalEnergyMwh = sum(plants.total_energy_mwh)`
     - `dailyEnergyMwh = sum(plants.daily_energy_kwh / 1000)` (convert kWh to MWh)
     - `monthlyEnergyMwh = sum(plants.monthly_energy_mwh)`
     - `yearlyEnergyMwh = sum(plants.yearly_energy_mwh)`
     - `currentPowerKw = sum(plants.current_power_kw)`
     - `installedCapacityKw = sum(plants.capacity_kw)`
- **Additional Metrics**:
  - `totalPlants`: Count of all plants (mapped + unmapped)
  - `mappedPlants`: Count of plants in active work orders
  - `unmappedPlants`: `totalPlants - mappedPlants`
  - `totalWorkOrders`: Count of all work orders
  - `activeAlerts`: Count of active alerts (all plants)

#### GOVT Dashboard
- **Scope**: All work orders (same as SUPERADMIN, but different widget visibility)
- **Query Pattern**: Same as SUPERADMIN (only plants mapped to work orders)
- **Metrics**: Same as SUPERADMIN (all production metrics)
- **Widget Visibility**: No alerts feed, no telemetry chart

#### ORG Dashboard
- **Scope**: Work orders for the organization only
- **Query Pattern**:
  1. Get all work orders for org: Query `config` table: `GSI1PK = ORG#org_id AND begins_with(GSI1SK, 'WORK_ORDER#')`
  2. Get all active plants in those work orders: Query `work-order-plants` table
  3. Query `plants` table: BatchGetItem for plant_ids
  4. Sum metrics (same as SUPERADMIN)
- **Metrics**: Same production metrics, but scoped to org

**Response Structure**:
```json
{
  "role": "SUPERADMIN",
  "metrics": {
    "totalPlants": 3622,
    "mappedPlants": 3000,
    "unmappedPlants": 622,
    "activeAlerts": 150,
    "totalWorkOrders": 25,
    "totalEnergyMwh": 500000.0,
    "dailyEnergyMwh": 5000.0,
    "monthlyEnergyMwh": 150000.0,
    "yearlyEnergyMwh": 1800000.0,
    "currentPowerKw": 7500.5,
    "installedCapacityKw": 100000.0
  },
  "widgets": {
    "showOrganizations": true,
    "showVendors": true,
    "showPlants": true,
    "showCreateWorkOrder": true,
    "showTelemetryChart": false,
    "showAlertsFeed": true,
    "showWorkOrdersSummary": true,
    "showOrgBreakdown": false,
    "showExportCSV": false
  }
}
```

**Important**: Dashboard metrics (totalEnergyMwh, currentPowerKw, etc.) are **only from plants mapped to work orders**, not all plants. This ensures consistency across all user roles.

## API Endpoints

### GET /api/workorders/[id]/production
**Purpose**: Get aggregated production metrics for a work order

**Response**:
```json
{
  "totalPlants": 25,
  "aggregated": {
    "installedCapacityKw": 5000.0,
    "currentPowerKw": 150.5,
    "dailyEnergyKwh": 120.5,
    "monthlyEnergyMwh": 3500.0,
    "yearlyEnergyMwh": 45000.0,
    "totalEnergyMwh": 50000.0
  },
  "plants": [
    {
      "id": 123,
      "name": "Solar Farm Alpha",
      "capacityKw": 1000.0,
      "currentPowerKw": 50.5,
      "dailyEnergyKwh": 25.5,
      "monthlyEnergyMwh": 750.0,
      "yearlyEnergyMwh": 9000.0,
      "totalEnergyMwh": 10000.0,
      "lastUpdateTime": "2025-01-15T10:00:00Z"
    }
  ]
}
```

### GET /api/orgs/[id]/production
**Purpose**: Get aggregated production metrics for an organization

**Response**:
```json
{
  "totalWorkOrders": 5,
  "totalPlants": 125,
  "aggregated": {
    "installedCapacityKw": 25000.0,
    "currentPowerKw": 750.5,
    "dailyEnergyKwh": 600.5,
    "monthlyEnergyMwh": 17500.0,
    "yearlyEnergyMwh": 225000.0,
    "totalEnergyMwh": 250000.0
  }
}
```

## WMS Device Association

**Work Order WMS Device**:
- Work Orders can optionally have a `wms_device_id` assigned
- WMS Device must belong to the same organization as the work order
- Used for insolation data association
- Stored in `config` table with work order entity

**Query Pattern**:
- When fetching work order, also fetch WMS device info if `wms_device_id` is set
- Join with `wms` table to get device, site, and vendor information

## Performance Optimization

### Batch Operations
- Use BatchGetItem for fetching multiple plants (25 items per batch)
- Parallel batch processing for large work orders

### Caching Strategy (Future)
- Consider caching aggregated metrics for frequently accessed work orders
- Cache TTL: 1-5 minutes (since plant data updates every 15 minutes)
- Invalidate cache on plant data updates

### Query Optimization
- Use BatchGetItem instead of individual GetItem calls
- Filter by `is_active = true` in application layer (not in DynamoDB query)
- Limit plant details in response (only return necessary fields)

## Cost Analysis

**Read Operations**:
- **Dashboard (SUPERADMIN/GOVT)**: 
  - Get all work orders: ~1 query
  - Get all work-order-plants: ~1-5 queries (pagination if >1000 mappings)
  - Get all mapped plants: ~120-200 BatchGetItem calls (3000 plants / 25 per batch)
  - Total: ~125-210 queries per dashboard load
- **Dashboard (ORG)**: 
  - Get org work orders: ~1 query
  - Get work-order-plants: ~1-2 queries
  - Get mapped plants: ~2-80 BatchGetItem calls (50-2000 plants)
  - Total: ~5-85 queries per dashboard load
- **Work Order Production**: ~10-100 plants per query = 1-4 BatchGetItem calls
- **Organization Production**: ~50-2000 plants per query = 2-80 BatchGetItem calls
- **Daily queries**: 
  - Dashboard: ~30 users × 5 loads/day × 150 queries = ~22.5K queries/day
  - Work Order Production: ~100 queries/day
  - Org Production: ~20 queries/day
  - Total: ~22.6K queries/day = ~678K queries/month
- **Monthly**: ~678K reads (within free tier)

**Cost**: $0 (within 64.8M reads/month free tier)

## Implementation Notes

1. **No Pre-aggregation**: Metrics calculated dynamically from plant data
2. **Source of Truth**: `plants` table is the single source of truth
3. **Update Frequency**: Plant metrics updated every 15 minutes
4. **Aggregation**: Sum operation (simple, fast, accurate)
5. **WMS Association**: Optional, stored in work order entity
6. **Dashboard Scope**: Dashboard metrics aggregate **only from plants mapped to work orders** (not all plants)
   - This ensures consistency: SUPERADMIN, GOVT, and ORG all see metrics from work-order-mapped plants
   - Unmapped plants are excluded from production metrics (but counted in totalPlants)

