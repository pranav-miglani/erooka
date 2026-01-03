/**
 * Alert Sync Service
 * 
 * Syncs alerts from all vendors across all organizations.
 * Based on WOMS alertSyncService implementation.
 * 
 * Key Features:
 * - Vendor-specific alert fetching (Solarman, SolarDM, etc.)
 * - Alert deduplication (vendor_id, vendor_plant_id, vendor_alert_id)
 * - Grid downtime calculation
 * - Batch create to DynamoDB
 */

import { VendorManager } from "../../infrastructure/vendors/VendorManager"
import type { VendorConfig } from "../../infrastructure/vendors/types"
import type { AlertRepository, CreateAlertInput, Alert } from "../../domain/alert/Alert"
import type { VendorRepository } from "../../domain/vendor/Vendor"
import type { PlantRepository } from "../../domain/plant/Plant"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

export interface AlertSyncResult {
  vendorId: number
  vendorName: string
  orgId: number
  orgName?: string
  success: boolean
  synced: number
  created: number
  updated: number
  skipped: number
  total: number
  error?: string
}

export interface AlertSyncSummary {
  totalVendors: number
  successful: number
  failed: number
  totalAlertsSynced: number
  totalAlertsCreated: number
  totalAlertsUpdated: number
  totalAlertsSkipped: number
  results: AlertSyncResult[]
  duration: number
}

/**
 * Calculate grid downtime hours within 9 AM - 4 PM window
 */
function calculateGridDownHoursWithinWindow(
  start: Date | null,
  end: Date | null,
  timeZone: string = "Asia/Calcutta"
): number {
  if (!start || !end || end <= start) return 0

  let totalMs = 0
  let cursor = start

  while (cursor < end) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })

    const parts = formatter.formatToParts(cursor)
    const values: Record<string, number> = {}
    for (const part of parts) {
      if (part.type !== "literal") {
        values[part.type] = parseInt(part.value, 10)
      }
    }

    if (!values.year || !values.month || !values.day) {
      break
    }

    // 9 AM - 4 PM window in local timezone
    const windowStart = new Date(Date.UTC(values.year, values.month - 1, values.day, 9, 0, 0))
    const windowEnd = new Date(Date.UTC(values.year, values.month - 1, values.day, 16, 0, 0))
    
    // Convert to UTC considering timezone offset
    const offset = windowStart.getTime() - new Date(cursor.getTime()).getTime()
    const windowStartUtc = new Date(windowStart.getTime() - offset)
    const windowEndUtc = new Date(windowEnd.getTime() - offset)

    const overlapStart = Math.max(cursor.getTime(), windowStartUtc.getTime())
    const overlapEnd = Math.min(end.getTime(), windowEndUtc.getTime())

    if (overlapEnd > overlapStart) {
      totalMs += overlapEnd - overlapStart
    }

    // Move to next day
    const nextDay = new Date(cursor)
    nextDay.setDate(nextDay.getDate() + 1)
    nextDay.setHours(0, 0, 0, 0)
    cursor = nextDay
  }

  return totalMs / (1000 * 60 * 60)
}

/**
 * Calculate grid downtime benefit in kWh
 */
function calculateGridDownBenefitKwh(
  start: Date | null,
  end: Date | null,
  capacityKw: number | null | undefined,
  timeZone: string = "Asia/Calcutta"
): number | null {
  if (!start || !end || !capacityKw || capacityKw <= 0) {
    return null
  }

  const hours = calculateGridDownHoursWithinWindow(start, end, timeZone)
  if (hours <= 0) {
    return null
  }

  // Benefit = 0.5 * hours * capacityKw (50% efficiency assumption)
  const benefit = 0.5 * hours * capacityKw
  return Number(benefit.toFixed(3))
}

/**
 * Get vendor alerts start date from credentials
 */
function getVendorAlertsStartDate(vendor: any): Date {
  const credentials = (vendor.credentials || {}) as Record<string, any>
  const configured = credentials.alertsStartDate as string | undefined

  const oneYearMs = 365 * 24 * 60 * 60 * 1000
  const now = Date.now()
  const fallback = new Date(now - oneYearMs)

  if (!configured) {
    return fallback
  }

  const parsed = new Date(configured)
  if (Number.isNaN(parsed.getTime())) {
    console.warn(
      `⚠️ Invalid alertsStartDate for vendor ${vendor.id}, falling back to 1 year lookback`
    )
    return fallback
  }

  return parsed.getTime() < fallback.getTime() ? fallback : parsed
}

export class AlertSyncService {
  constructor(
    private alertRepository: AlertRepository,
    private vendorRepository: VendorRepository,
    private plantRepository: PlantRepository,
    private dynamoClient: DynamoDBDocumentClient
  ) {}

  /**
   * Sync alerts for all active vendors
   */
  async syncAllVendors(): Promise<AlertSyncSummary> {
    const startTime = Date.now()
    
    const vendors = await this.vendorRepository.findAll()
    const activeVendors = vendors.filter((v) => v.isActive)

    console.log(`[AlertSync] Starting sync for ${activeVendors.length} active vendors`)

    const CONCURRENT_LIMIT = 10
    const results: AlertSyncResult[] = []
    
    for (let i = 0; i < activeVendors.length; i += CONCURRENT_LIMIT) {
      const batch = activeVendors.slice(i, i + CONCURRENT_LIMIT)
      const batchResults = await Promise.all(
        batch.map((vendor) => this.syncVendorAlerts(vendor))
      )
      results.push(...batchResults)
    }

    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const totalAlertsSynced = results.reduce((sum, r) => sum + r.synced, 0)
    const totalAlertsCreated = results.reduce((sum, r) => sum + r.created, 0)
    const totalAlertsUpdated = results.reduce((sum, r) => sum + r.updated, 0)
    const totalAlertsSkipped = results.reduce((sum, r) => sum + r.skipped, 0)

    const duration = Date.now() - startTime

    console.log(
      `[AlertSync] Completed: ${successful}/${activeVendors.length} vendors successful, ` +
      `${totalAlertsSynced} alerts synced (${totalAlertsCreated} created, ${totalAlertsUpdated} updated, ${totalAlertsSkipped} skipped) in ${duration}ms`
    )

    return {
      totalVendors: activeVendors.length,
      successful,
      failed,
      totalAlertsSynced,
      totalAlertsCreated,
      totalAlertsUpdated,
      totalAlertsSkipped,
      results,
      duration,
    }
  }

  /**
   * Sync alerts for a single vendor
   */
  async syncVendorAlerts(vendor: any): Promise<AlertSyncResult> {
    const startTime = Date.now()
    const result: AlertSyncResult = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orgId: vendor.orgId,
      success: false,
      synced: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      total: 0,
    }

    try {
      console.log(`[AlertSync] Syncing vendor ${vendor.id} (${vendor.name})`)

      // Get plants for this vendor
      const plants = await this.plantRepository.findByVendorId(vendor.id)
      
      if (plants.length === 0) {
        result.success = true
        console.log(`[AlertSync] No plants found for vendor ${vendor.name}`)
        return result
      }

      // Build plant mapping: vendor_plant_id -> plant_id
      const plantMap = new Map<string, { plantId: number; capacityKw: number | null }>()
      plants.forEach((p) => {
        plantMap.set(p.vendorPlantId, {
          plantId: p.id,
          capacityKw: p.capacityKw,
        })
      })

      // Create vendor adapter
      const vendorConfig: VendorConfig = {
        id: vendor.id,
        name: vendor.name,
        vendorType: vendor.vendorType as "SOLARMAN" | "SOLARDM" | "SHINEMONITOR" | "PVBLINK" | "FOXESSCLOUD" | "OTHER",
        credentials: vendor.credentials as Record<string, any>,
        isActive: vendor.isActive,
      }

      const adapter = VendorManager.getAdapter(vendorConfig)

      // Set token storage
      if (typeof (adapter as any).setTokenStorage === "function") {
        (adapter as any).setTokenStorage(vendor.id, this.dynamoClient)
      }

      // Authenticate
      await adapter.authenticate()

      // Fetch alerts for each plant
      const alertInputs: CreateAlertInput[] = []
      const startDate = getVendorAlertsStartDate(vendor)

      for (const plant of plants) {
        try {
          const vendorAlerts = await adapter.getAlerts(plant.vendorPlantId)
          
          for (const vendorAlert of vendorAlerts) {
            const plantMapping = plantMap.get(plant.vendorPlantId)
            if (!plantMapping) {
              continue
            }

            // Check for existing alert (deduplication)
            const existing = await this.alertRepository.findByVendorAndPlant(
              vendor.id,
              plant.vendorPlantId,
              vendorAlert.vendorAlertId || ""
            )

            if (existing) {
              // Update if needed
              const alertTime = new Date() // Vendor adapters should provide alertTime
              if (existing.alertTime.getTime() !== alertTime.getTime()) {
                await this.alertRepository.update(existing.id, {
                  alertTime,
                  severity: vendorAlert.severity,
                  description: vendorAlert.description,
                })
                result.updated++
              } else {
                result.skipped++
              }
              continue
            }

            // Create new alert
            const alertTime = new Date() // Should come from vendor adapter
            const endTime = null // Should come from vendor adapter if resolved

            // Calculate grid downtime
            const gridDownSeconds = endTime && alertTime
              ? Math.floor((endTime.getTime() - alertTime.getTime()) / 1000)
              : null

            const gridDownBenefitKwh = calculateGridDownBenefitKwh(
              alertTime,
              endTime,
              plantMapping.capacityKw
            )

            alertInputs.push({
              plantId: plantMapping.plantId,
              vendorId: vendor.id,
              vendorAlertId: vendorAlert.vendorAlertId || null,
              title: vendorAlert.title,
              description: vendorAlert.description || null,
              severity: vendorAlert.severity,
              status: "ACTIVE", // Default to ACTIVE, update if endTime is present
              alertTime,
            })
          }
        } catch (error: any) {
          console.error(`[AlertSync] Error fetching alerts for plant ${plant.vendorPlantId}:`, error)
        }
      }

      // Batch create alerts
      if (alertInputs.length > 0) {
        await this.alertRepository.batchCreate(alertInputs)
        result.created = alertInputs.length
      }

      result.success = true
      result.synced = result.created + result.updated
      result.total = result.synced + result.skipped

      const duration = Date.now() - startTime
      console.log(
        `[AlertSync] Vendor ${vendor.name}: ${result.synced} alerts synced ` +
        `(${result.created} created, ${result.updated} updated, ${result.skipped} skipped) in ${duration}ms`
      )

      return result
    } catch (error: any) {
      console.error(`[AlertSync] Error syncing vendor ${vendor.name}:`, error)
      result.error = error.message || "Unknown error"
      return result
    }
  }
}

