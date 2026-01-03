/**
 * Live Telemetry Sync Service
 * 
 * Syncs live telemetry data (current power, daily energy, etc.) for all plants.
 * Runs every 15 minutes to update production metrics.
 * 
 * This is separate from plant sync - it only updates production metrics,
 * not plant metadata (name, location, etc.).
 */

import { VendorManager } from "../../infrastructure/vendors/VendorManager"
import type { VendorConfig } from "../../infrastructure/vendors/types"
import type { PlantRepository, UpdatePlantInput } from "../../domain/plant/Plant"
import type { VendorRepository } from "../../domain/vendor/Vendor"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

export interface TelemetrySyncResult {
  vendorId: number
  vendorName: string
  orgId: number
  success: boolean
  synced: number
  updated: number
  failed: number
  error?: string
}

export interface TelemetrySyncSummary {
  totalVendors: number
  successful: number
  failed: number
  totalPlantsSynced: number
  totalPlantsUpdated: number
  results: TelemetrySyncResult[]
  duration: number
}

export class TelemetrySyncService {
  constructor(
    private plantRepository: PlantRepository,
    private vendorRepository: VendorRepository,
    private dynamoClient: DynamoDBDocumentClient
  ) {}

  /**
   * Sync live telemetry for all active vendors
   */
  async syncAllVendors(): Promise<TelemetrySyncSummary> {
    const startTime = Date.now()
    
    const vendors = await this.vendorRepository.findAll()
    const activeVendors = vendors.filter((v) => v.isActive)

    console.log(`[TelemetrySync] Starting sync for ${activeVendors.length} active vendors`)

    const CONCURRENT_LIMIT = 10
    const results: TelemetrySyncResult[] = []
    
    for (let i = 0; i < activeVendors.length; i += CONCURRENT_LIMIT) {
      const batch = activeVendors.slice(i, i + CONCURRENT_LIMIT)
      const batchResults = await Promise.all(
        batch.map((vendor) => this.syncVendorTelemetry(vendor))
      )
      results.push(...batchResults)
    }

    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const totalPlantsSynced = results.reduce((sum, r) => sum + r.synced, 0)
    const totalPlantsUpdated = results.reduce((sum, r) => sum + r.updated, 0)

    const duration = Date.now() - startTime

    console.log(
      `[TelemetrySync] Completed: ${successful}/${activeVendors.length} vendors successful, ` +
      `${totalPlantsSynced} plants synced (${totalPlantsUpdated} updated) in ${duration}ms`
    )

    return {
      totalVendors: activeVendors.length,
      successful,
      failed,
      totalPlantsSynced,
      totalPlantsUpdated,
      results,
      duration,
    }
  }

  /**
   * Sync live telemetry for a single vendor
   */
  async syncVendorTelemetry(vendor: any): Promise<TelemetrySyncResult> {
    const startTime = Date.now()
    const result: TelemetrySyncResult = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orgId: vendor.orgId,
      success: false,
      synced: 0,
      updated: 0,
      failed: 0,
    }

    try {
      console.log(`[TelemetrySync] Syncing vendor ${vendor.id} (${vendor.name})`)

      // Get all plants for this vendor
      const plants = await this.plantRepository.findByVendorId(vendor.id)
      
      if (plants.length === 0) {
        result.success = true
        return result
      }

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

      // Fetch live telemetry for each plant
      const plantUpdates: Array<{ id: number; updates: UpdatePlantInput }> = []

      // Process plants in parallel (max 20 concurrent)
      const CONCURRENT_PLANTS = 20
      for (let i = 0; i < plants.length; i += CONCURRENT_PLANTS) {
        const batch = plants.slice(i, i + CONCURRENT_PLANTS)
        
        const batchResults = await Promise.allSettled(
          batch.map(async (plant) => {
            try {
              // Use listPlant() to get live telemetry
              const vendorPlant = await adapter.listPlant(plant.vendorPlantId)
              
              if (!vendorPlant) {
                return null
              }

              const metadata = vendorPlant.metadata || {}
              
              // Determine if online
              const networkStatus = metadata.networkStatus 
                ? String(metadata.networkStatus).trim() 
                : null
              const isOnline = networkStatus === "NORMAL" || networkStatus === "ONLINE"

              // Handle lastUpdateTime
              let lastUpdateTime: Date | null = null
              if (metadata.lastUpdateTime) {
                if (typeof metadata.lastUpdateTime === 'string') {
                  lastUpdateTime = new Date(metadata.lastUpdateTime)
                } else if (typeof metadata.lastUpdateTime === 'number') {
                  lastUpdateTime = new Date(metadata.lastUpdateTime * 1000)
                }
              }

              return {
                id: plant.id,
                updates: {
                  currentPowerKw: metadata.currentPowerKw ?? null,
                  dailyEnergyKwh: metadata.dailyEnergyKwh ?? null,
                  monthlyEnergyMwh: metadata.monthlyEnergyMwh ?? null,
                  yearlyEnergyMwh: metadata.yearlyEnergyMwh ?? null,
                  totalEnergyMwh: metadata.totalEnergyMwh ?? null,
                  isOnline,
                  lastUpdateTime,
                  lastRefreshedAt: new Date(),
                },
              }
            } catch (error: any) {
              console.error(`[TelemetrySync] Error fetching telemetry for plant ${plant.id}:`, error)
              return null
            }
          })
        )

        // Collect successful updates
        for (const batchResult of batchResults) {
          if (batchResult.status === "fulfilled" && batchResult.value) {
            plantUpdates.push(batchResult.value)
          } else if (batchResult.status === "rejected") {
            result.failed++
          }
        }
      }

      // Batch update plants (25 items per batch)
      const BATCH_SIZE = 25
      let updated = 0

      for (let i = 0; i < plantUpdates.length; i += BATCH_SIZE) {
        const batch = plantUpdates.slice(i, i + BATCH_SIZE)
        try {
          await this.plantRepository.batchUpdate(batch)
          updated += batch.length
        } catch (error: any) {
          console.error(`[TelemetrySync] Error updating batch:`, error)
          // Fallback: individual updates
          for (const update of batch) {
            try {
              await this.plantRepository.update(update.id, update.updates)
              updated++
            } catch (individualError: any) {
              console.error(`[TelemetrySync] Error updating plant ${update.id}:`, individualError)
              result.failed++
            }
          }
        }
      }

      result.success = result.failed < plants.length
      result.synced = plantUpdates.length
      result.updated = updated

      const duration = Date.now() - startTime
      console.log(
        `[TelemetrySync] Vendor ${vendor.name}: ${result.synced} plants synced ` +
        `(${result.updated} updated, ${result.failed} failed) in ${duration}ms`
      )

      return result
    } catch (error: any) {
      console.error(`[TelemetrySync] Error syncing vendor ${vendor.name}:`, error)
      result.error = error.message || "Unknown error"
      return result
    }
  }
}

