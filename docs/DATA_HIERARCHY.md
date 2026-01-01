# Data Hierarchy & Relationships

## Core Hierarchy

```
Work Order (assigned to Organization)
  └── Organization
       ├── Vendors (20-50 max per org)
       │    └── Plants (multiple per vendor, 7K total)
       │         └── Alerts (multiple per plant, 35K/day)
       └── Work Orders (multiple per org)
            └── Plants (via work-order-plants, from multiple vendors within same org)
```

## Relationship Rules

### Work Orders
- **Required**: `org_id` - Work Orders must be assigned to an Organization
- **Optional**: `wms_device_id` - WMS Device can be assigned to a Work Order (must belong to same org)
- **Contains**: Plants from multiple Vendors (all within the same Organization)
- **Constraint**: One active Work Order per Plant (enforced via work-order-plants table)
- **Production Metrics**: Aggregated from all plants in the work order (sum of plant metrics)

### Organizations
- **Has**: Multiple Vendors (20-50 max per org)
- **Has**: Multiple Work Orders
- **Has**: Multiple Plants (through Vendors)

### Vendors
- **Required**: `org_id` - Vendors belong to Organizations
- **Has**: Multiple Plants
- **Volume**: 20-50 vendors max per org (less than 100 total)

### Plants
- **Required**: `org_id` - Plants belong to Organizations
- **Required**: `vendor_id` - Plants belong to Vendors
- **Unique**: `(vendor_id, vendor_plant_id)` - One plant per vendor_plant_id per vendor
- **Volume**: 7,000 plants max (3,622 currently loaded)
- **Updates**: Every 15 minutes (5 AM - 8 PM working window)
- **Attributes Updated**: current_power_kw, daily_energy_kwh, total_energy_mwh, monthly_energy_mwh, yearly_energy_mwh, is_online
- **Production Metrics**: Stored in plants table (source of truth for aggregation)

### Alerts
- **Required**: `plant_id` - Alerts belong to Plants
- **Required**: `vendor_id` - Alerts belong to Vendors (for deduplication)
- **Volume**: ~35,000 alerts/day (~1M alerts/month)
- **TTL**: 180 days (6 months retention)

## Table Mapping

| Entity | Table | Key Relationships |
|--------|-------|-------------------|
| Work Orders | `config` | org_id (required), optional wms_device_id |
| Organizations | `config` | Parent entity |
| Vendors | `config` | org_id (required) |
| Plants | `plants` | org_id, vendor_id (both required) |
| Alerts | `alerts` | plant_id, vendor_id (both required) |
| Work Order Plants | `work-order-plants` | work_order_id, plant_id, is_active |

## Query Patterns

### By Organization
1. Get all Vendors for an Org: `config` table, GSI1 (org-index)
2. Get all Plants for an Org: `plants` table, GSI1 (org-index)
3. Get all Work Orders for an Org: `config` table, GSI1 (org-index)

### By Vendor
1. Get all Plants for a Vendor: `plants` table, GSI2 (vendor-index)

### By Work Order
1. Get all Plants in a Work Order: `work-order-plants` table, PK = WORK_ORDER#id
2. Get Work Orders for a Plant: `work-order-plants` table, GSI1 (plant-workorder-index)
3. Get Work Order Production Metrics: Query all plants in work order, sum their metrics
4. Get Organization Production Metrics: Query all work orders for org → Query all plants → Sum metrics

### By Plant
1. Get all Alerts for a Plant: `alerts` table, GSI2 (plant-alert-index) - MOST COMMON QUERY

