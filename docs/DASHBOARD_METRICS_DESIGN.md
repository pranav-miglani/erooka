# Dashboard Metrics Design

## Overview

The dashboard aggregates production metrics from **plants mapped to work orders only**. This ensures consistency across all user roles (SUPERADMIN, GOVT, ORG) and provides accurate metrics for work order management.

## Key Principle

**Dashboard production metrics = Sum of all plants that are mapped to active work orders**

- Unmapped plants are **excluded** from production metrics
- Unmapped plants are still counted in `totalPlants` metric
- This ensures metrics reflect actual work order coverage

## User Role Behavior

### SUPERADMIN / DEVELOPER

**Scope**: All work orders across all organizations

**Query Pattern**:
1. Get all work orders: Query `config` table for all `WORK_ORDER` entities
2. Get all active plant mappings: Query `work-order-plants` table where `is_active = true`
   - Use pagination if >1000 mappings
3. Extract unique `plant_id` values from mappings
4. Query `plants` table: BatchGetItem for all plant_ids (25 items per batch)
5. Sum metrics from all mapped plants

**Metrics Calculated**:
```typescript
{
  totalPlants: number,              // All plants (mapped + unmapped)
  mappedPlants: number,             // Plants in active work orders
  unmappedPlants: number,           // totalPlants - mappedPlants
  activeAlerts: number,             // Active alerts (all plants)
  totalWorkOrders: number,          // All work orders
  // Production metrics (from mapped plants only):
  totalEnergyMwh: number,          // Sum of total_energy_mwh
  dailyEnergyMwh: number,           // Sum of daily_energy_kwh / 1000
  monthlyEnergyMwh: number,        // Sum of monthly_energy_mwh
  yearlyEnergyMwh: number,          // Sum of yearly_energy_mwh
  currentPowerKw: number,          // Sum of current_power_kw
  installedCapacityKw: number      // Sum of capacity_kw
}
```

**Widget Visibility**:
- ✅ Organizations
- ✅ Vendors
- ✅ Plants
- ✅ Create Work Order
- ✅ Alerts Feed
- ✅ Work Orders Summary
- ❌ Telemetry Chart
- ❌ Org Breakdown
- ❌ Export CSV

### GOVT

**Scope**: All work orders across all organizations (same as SUPERADMIN)

**Query Pattern**: Identical to SUPERADMIN

**Metrics**: Same as SUPERADMIN (all production metrics from mapped plants)

**Widget Visibility**:
- ❌ Organizations
- ❌ Vendors
- ❌ Plants
- ❌ Create Work Order
- ❌ Alerts Feed
- ✅ Work Orders Summary
- ❌ Telemetry Chart
- ✅ Org Breakdown
- ✅ Export CSV

**Key Difference**: GOVT sees same metrics but different widget visibility (no alerts, no plant management)

### ORG

**Scope**: Work orders for the organization only

**Query Pattern**:
1. Get all work orders for org: Query `config` table: `GSI1PK = ORG#org_id AND begins_with(GSI1SK, 'WORK_ORDER#')`
2. Get all active plant mappings: Query `work-order-plants` table for those work orders
3. Extract unique `plant_id` values
4. Query `plants` table: BatchGetItem for plant_ids
5. Sum metrics (same as SUPERADMIN)

**Metrics**: Same production metrics, but scoped to organization's work orders

**Widget Visibility**:
- ❌ Organizations
- ❌ Vendors
- ✅ Plants (org-scoped)
- ❌ Create Work Order
- ✅ Alerts Feed (org-scoped)
- ✅ Work Orders Summary (org-scoped)
- ❌ Telemetry Chart
- ❌ Org Breakdown
- ❌ Export CSV

## API Endpoint

### GET /api/dashboard

**Authentication**: Required (session cookie)

**Response**:
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

## DynamoDB Query Strategy

### Step 1: Get All Work Orders

**SUPERADMIN/GOVT**:
```typescript
// Query config table for all work orders
const params = {
  TableName: 'config',
  IndexName: 'org-index',
  KeyConditionExpression: 'GSI1PK = :pk',
  ExpressionAttributeValues: {
    ':pk': 'WORK_ORDER'
  }
}
// Or scan with filter (if work orders don't have org-index)
// Better: Use a GSI with PK = ENTITY_TYPE, SK = ENTITY_ID
```

**ORG**:
```typescript
// Query config table for org work orders
const params = {
  TableName: 'config',
  IndexName: 'org-index',
  KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
  ExpressionAttributeValues: {
    ':pk': `ORG#${orgId}`,
    ':sk': 'WORK_ORDER#'
  }
}
```

### Step 2: Get Work Order Plant Mappings

```typescript
// BatchGetItem for all work orders
const workOrderIds = workOrders.map(wo => wo.id)
const batches = chunk(workOrderIds, 25) // DynamoDB batch limit

const mappings = []
for (const batch of batches) {
  const params = {
    RequestItems: {
      'work-order-plants': {
        Keys: batch.map(woId => ({
          PK: `WORK_ORDER#${woId}`,
          SK: { begins_with: 'PLANT#' } // Need to query, not BatchGetItem
        }))
      }
    }
  }
  // Actually need Query, not BatchGetItem (since we need all plants for each work order)
}

// Better approach: Query each work order
for (const workOrderId of workOrderIds) {
  const params = {
    TableName: 'work-order-plants',
    KeyConditionExpression: 'PK = :pk',
    FilterExpression: 'is_active = :active',
    ExpressionAttributeValues: {
      ':pk': `WORK_ORDER#${workOrderId}`,
      ':active': true
    }
  }
  const result = await dynamodb.query(params).promise()
  mappings.push(...result.Items)
}
```

### Step 3: Extract Unique Plant IDs

```typescript
const plantIds = [...new Set(mappings.map(m => m.plant_id))]
```

### Step 4: BatchGetItem for Plants

```typescript
const batches = chunk(plantIds, 25) // DynamoDB batch limit
const plants = []

for (const batch of batches) {
  const params = {
    RequestItems: {
      'plants': {
        Keys: batch.map(plantId => ({
          PK: `PLANT#${plantId}`,
          SK: `PLANT#${plantId}`
        }))
      }
    }
  }
  const result = await dynamodb.batchGetItem(params).promise()
  plants.push(...result.Responses.plants)
}
```

### Step 5: Aggregate Metrics

```typescript
const metrics = {
  totalEnergyMwh: plants.reduce((sum, p) => sum + (p.total_energy_mwh || 0), 0),
  dailyEnergyMwh: plants.reduce((sum, p) => sum + ((p.daily_energy_kwh || 0) / 1000), 0),
  monthlyEnergyMwh: plants.reduce((sum, p) => sum + (p.monthly_energy_mwh || 0), 0),
  yearlyEnergyMwh: plants.reduce((sum, p) => sum + (p.yearly_energy_mwh || 0), 0),
  currentPowerKw: plants.reduce((sum, p) => sum + (p.current_power_kw || 0), 0),
  installedCapacityKw: plants.reduce((sum, p) => sum + (p.capacity_kw || 0), 0)
}
```

## Performance Optimization

### Parallel Queries
- Query work orders and work-order-plants in parallel where possible
- Use Promise.all for independent queries

### Caching Strategy
- Cache dashboard metrics for 1-5 minutes (since plant data updates every 15 minutes)
- Cache key: `dashboard:${role}:${orgId || 'all'}`
- Invalidate on work order changes or plant mapping changes

### Pagination
- Handle pagination for work-order-plants queries (if >1000 mappings)
- Use LastEvaluatedKey for pagination

## Cost Analysis

**Read Operations per Dashboard Load**:
- Get work orders: ~1-5 queries (depending on scope)
- Get work-order-plants: ~1-10 queries (pagination if needed)
- Get plants: ~120-200 BatchGetItem calls (3000 plants / 25 per batch)
- **Total**: ~125-220 queries per SUPERADMIN/GOVT dashboard load
- **Total**: ~5-85 queries per ORG dashboard load

**Daily Load**:
- 30 users × 5 dashboard loads/day × 150 queries = ~22.5K queries/day
- Monthly: ~675K reads (within free tier)

**Cost**: $0 (within 64.8M reads/month free tier)

## Implementation Notes

1. **Consistency**: All roles see metrics from mapped plants only
2. **Efficiency**: Use BatchGetItem for plants (25 items per batch)
3. **Accuracy**: Sum operation ensures no data loss
4. **Scalability**: Pagination handles large datasets
5. **Caching**: Optional caching for frequently accessed dashboards

