# Vendor Adapters Implementation Status

## Overview

Vendor adapters are required to integrate with different solar monitoring vendor APIs (Solarman, SolarDM, ShineMonitor, PVBlink, FoxessCloud). Each adapter normalizes vendor-specific data to our standard format.

## Status: 🚧 In Progress

### Completed ✅
- Base vendor adapter structure (`BaseVendorAdapter.ts`)
- Vendor types (`types.ts`)
- VendorManager factory (`VendorManager.ts`)
- HTTP client (`httpClient.ts`)

### Pending ⏳
- **SolarmanAdapter** - ~1600 lines (needs full implementation)
- **SolarDmAdapter** - ~1400 lines (needs full implementation)
- **ShineMonitorAdapter** - ~1700 lines (needs full implementation)
- **PvBlinkAdapter** - ~900 lines (needs full implementation)
- **FoxesscloudAdapter** - ~400 lines (needs full implementation)

## Required Attribute Mappings

### Plant Attributes (from vendor → normalized)
- `id` → `vendor_plant_id` (string)
- `name` → `name` (string)
- `capacityKw` → `capacity_kw` (number, convert from W if needed)
- `location` → `location` (lat, lng, address)
- `metadata.currentPowerKw` → `current_power_kw` (number, convert from W if needed)
- `metadata.dailyEnergyKwh` → `daily_energy_kwh` (number)
- `metadata.monthlyEnergyMwh` → `monthly_energy_mwh` (number, convert from kWh if needed)
- `metadata.yearlyEnergyMwh` → `yearly_energy_mwh` (number, convert from kWh if needed)
- `metadata.totalEnergyMwh` → `total_energy_mwh` (number, convert from kWh if needed)
- `metadata.networkStatus` → `network_status` (NORMAL, ALL_OFFLINE, PARTIAL_OFFLINE)
- `metadata.lastUpdateTime` → `last_update_time` (ISO string)
- `metadata.createdDate` → `created_at` (ISO string)
- `metadata.startOperatingTime` → `start_operating_time` (ISO string)

### Alert Attributes (from vendor → normalized)
- `vendorAlertId` → `vendor_alert_id` (string)
- `title` → `title` (string)
- `description` → `description` (string)
- `severity` → `severity` (LOW, MEDIUM, HIGH, CRITICAL)
- Vendor-specific alert time → `alert_time` (ISO string)
- Vendor-specific end time → `end_time` (ISO string, optional)

### Telemetry Attributes (from vendor → normalized)
- `plantId` → `plant_id` (string)
- `timestamp` → `timestamp` (Date)
- `generationPowerKw` → `power_kw` (number)
- `voltage` → `voltage` (number, optional)
- `current` → `current` (number, optional)
- `temperature` → `temperature` (number, optional)
- `irradiance` → `irradiance` (number, optional)
- `efficiencyPct` → `efficiency_pct` (number, optional)

## Implementation Notes

1. **Token Management**: All adapters need DynamoDB-backed token storage (not in-memory cache)
2. **Error Handling**: Comprehensive error handling and logging
3. **Rate Limiting**: Respect vendor API rate limits
4. **Pagination**: Handle paginated responses (Solarman, SolarDM)
5. **Date/Time Conversion**: Normalize all timestamps to ISO strings
6. **Unit Conversion**: 
   - Power: W → kW (divide by 1000)
   - Energy: kWh → MWh (divide by 1000) for monthly/yearly/total
   - Daily energy stays in kWh

## Reference Implementation

See WOMS implementations:
- `/Users/apple/woms/lib/vendors/solarmanAdapter.ts`
- `/Users/apple/woms/lib/vendors/solarDmAdapter.ts`
- `/Users/apple/woms/lib/vendors/shineMonitorAdapter.ts`
- `/Users/apple/woms/lib/vendors/pvBlinkAdapter.ts`
- `/Users/apple/woms/lib/vendors/foxesscloudAdapter.ts`

## Next Steps

1. Implement SolarmanAdapter (highest priority - most used)
2. Implement SolarDmAdapter (second priority)
3. Implement ShineMonitorAdapter
4. Implement PvBlinkAdapter
5. Implement FoxesscloudAdapter
6. Register all adapters in VendorManager
7. Write unit tests for each adapter
8. Write integration tests with vendor APIs (mocked)

