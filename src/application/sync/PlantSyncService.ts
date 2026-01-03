/**
 * Plant Sync Service
 * 
 * Syncs plant data from all vendors across all organizations.
 * Based on WOMS plantSyncService implementation.
 * 
 * Key Features:
 * - Syncs all active vendors in parallel
 * - Batch writes to DynamoDB (25 items per batch)
 * - Handles token validation and refresh
 * - Updates last_synced_at timestamp
 */

import { VendorManager } from "../../infrastructure/vendors/VendorManager"
import type { VendorConfig, Plant as VendorPlant } from "../../infrastructure/vendors/types"
import type { PlantRepository, Plant, UpdatePlantInput } from "../../domain/plant/Plant"
import type { VendorRepository } from "../../domain/vendor/Vendor"
import type { OrganizationRepository } from "../../domain/organization/Organization"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"

export interface SyncResult {
  vendorId: number
  vendorName: string
  orgId: number
  orgName?: string
  success: boolean
  synced: number
  created: number
  updated: number
  total: number
  error?: string
}

export interface SyncSummary {
  totalVendors: number
  successful: number
  failed: number
  totalPlantsSynced: number
  totalPlantsCreated: number
  totalPlantsUpdated: number
  results: SyncResult[]
  duration: number
}

export class PlantSyncService {
  constructor(
    private plantRepository: PlantRepository,
    private vendorRepository: VendorRepository,
    private organizationRepository: OrganizationRepository,
    private dynamoClient: DynamoDBDocumentClient
  ) {}

  /**
   * Sync plants for all active vendors
   */
  async syncAllVendors(): Promise<SyncSummary> {
    const startTime = Date.now()
    
    // Get all active vendors
    const vendors = await this.vendorRepository.findAll()
    const activeVendors = vendors.filter((v) => v.isActive)

    console.log(`[PlantSync] Starting sync for ${activeVendors.length} active vendors`)

    // Sync vendors in parallel (max 10 concurrent)
    const CONCURRENT_LIMIT = 10
    const results: SyncResult[] = []
    
    for (let i = 0; i < activeVendors.length; i += CONCURRENT_LIMIT) {
      const batch = activeVendors.slice(i, i + CONCURRENT_LIMIT)
      const batchResults = await Promise.all(
        batch.map((vendor) => this.syncVendorPlants(vendor))
      )
      results.push(...batchResults)
    }

    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const totalPlantsSynced = results.reduce((sum, r) => sum + r.synced, 0)
    const totalPlantsCreated = results.reduce((sum, r) => sum + r.created, 0)
    const totalPlantsUpdated = results.reduce((sum, r) => sum + r.updated, 0)

    const duration = Date.now() - startTime

    console.log(
      `[PlantSync] Completed: ${successful}/${activeVendors.length} vendors successful, ` +
      `${totalPlantsSynced} plants synced (${totalPlantsCreated} created, ${totalPlantsUpdated} updated) in ${duration}ms`
    )

    return {
      totalVendors: activeVendors.length,
      successful,
      failed,
      totalPlantsSynced,
      totalPlantsCreated,
      totalPlantsUpdated,
      results,
      duration,
    }
  }

  /**
   * Sync plants for a single vendor
   */
  async syncVendorPlants(vendor: any): Promise<SyncResult> {
    const startTime = Date.now()
    const result: SyncResult = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orgId: vendor.orgId,
      success: false,
      synced: 0,
      created: 0,
      updated: 0,
      total: 0,
    }

    try {
      console.log(`[PlantSync] Syncing vendor ${vendor.id} (${vendor.name})`)

      // Get organization name
      if (vendor.orgId) {
        const org = await this.organizationRepository.findById(vendor.orgId)
        result.orgName = org?.name
      }

      // Create vendor adapter
      const vendorConfig: VendorConfig = {
        id: vendor.id,
        name: vendor.name,
        vendorType: vendor.vendorType as "SOLARMAN" | "SOLARDM" | "SHINEMONITOR" | "PVBLINK" | "FOXESSCLOUD" | "OTHER",
        credentials: vendor.credentials as Record<string, any>,
        isActive: vendor.isActive,
        perPlantSyncIntervalMinutes: vendor.perPlantSyncIntervalMinutes ?? 15,
        plantSyncTimeIst: vendor.plantSyncTimeIst || "02:00",
      }

      const adapter = VendorManager.getAdapter(vendorConfig)

      // Set token storage for adapters that support it
      if (typeof (adapter as any).setTokenStorage === "function") {
        (adapter as any).setTokenStorage(vendor.id, this.dynamoClient)
      }

      // Authenticate (will use cached token if valid)
      await adapter.authenticate()

      // Fetch plants from vendor
      console.log(`[PlantSync] Fetching plants for vendor ${vendor.name} (ID: ${vendor.id})`)
      let vendorPlants = await adapter.listPlants()

      if (!vendorPlants || vendorPlants.length === 0) {
        result.success = true
        result.total = 0
        console.log(`[PlantSync] No plants found for vendor ${vendor.name}`)
        return result
      }

      result.total = vendorPlants.length
      console.log(`[PlantSync] Found ${vendorPlants.length} plants for vendor ${vendor.name}`)

      // Get existing plants for this vendor
      const existingPlants = await this.plantRepository.findByVendorId(vendor.id)
      const existingMap = new Map<string, Plant>()
      existingPlants.forEach((p) => {
        existingMap.set(p.vendorPlantId, p)
      })

      // Prepare plant updates
      const plantUpdates: Array<{ id: number; updates: UpdatePlantInput }> = []
      const newPlants: Array<{
        orgId: number
        vendorId: number
        vendorPlantId: string
        name: string
        capacityKw: number
        location?: Record<string, any>
      }> = []

      for (const vendorPlant of vendorPlants) {
        const metadata = vendorPlant.metadata || {}
        
        // Handle timestamps
        let lastUpdateTime: Date | null = null
        if (metadata.lastUpdateTime) {
          if (typeof metadata.lastUpdateTime === 'string') {
            lastUpdateTime = new Date(metadata.lastUpdateTime)
          } else if (typeof metadata.lastUpdateTime === 'number') {
            lastUpdateTime = new Date(metadata.lastUpdateTime * 1000)
          }
        }

        let createdDate: Date | null = null
        if (metadata.createdDate) {
          if (typeof metadata.createdDate === 'string') {
            createdDate = new Date(metadata.createdDate)
          } else if (typeof metadata.createdDate === 'number') {
            createdDate = new Date(metadata.createdDate * 1000)
          }
        }

        let startOperatingTime: Date | null = null
        if (metadata.startOperatingTime) {
          if (typeof metadata.startOperatingTime === 'string') {
            startOperatingTime = new Date(metadata.startOperatingTime)
          } else if (typeof metadata.startOperatingTime === 'number') {
            startOperatingTime = new Date(metadata.startOperatingTime * 1000)
          }
        }

        // Ensure location.address is included
        const location = vendorPlant.location || {}
        if (metadata.locationAddress && !location.address) {
          location.address = metadata.locationAddress
        }

        // Normalize network status
        const networkStatus = metadata.networkStatus 
          ? String(metadata.networkStatus).trim() 
          : null

        // Determine if online based on network status
        const isOnline = networkStatus === "NORMAL" || networkStatus === "ONLINE"

        const existingPlant = existingMap.get(vendorPlant.id)

        if (existingPlant) {
          // Update existing plant
          plantUpdates.push({
            id: existingPlant.id,
            updates: {
              name: vendorPlant.name || existingPlant.name,
              capacityKw: vendorPlant.capacityKw || existingPlant.capacityKw,
              location,
              currentPowerKw: metadata.currentPowerKw ?? null,
              dailyEnergyKwh: metadata.dailyEnergyKwh ?? null,
              monthlyEnergyMwh: metadata.monthlyEnergyMwh ?? null,
              yearlyEnergyMwh: metadata.yearlyEnergyMwh ?? null,
              totalEnergyMwh: metadata.totalEnergyMwh ?? null,
              isOnline,
              lastUpdateTime,
              lastRefreshedAt: new Date(),
            },
          })
        } else {
          // Create new plant
          newPlants.push({
            orgId: vendor.orgId,
            vendorId: vendor.id,
            vendorPlantId: vendorPlant.id,
            name: vendorPlant.name || `Plant ${vendorPlant.id}`,
            capacityKw: vendorPlant.capacityKw || 0,
            location,
          })
        }
      }

      // Batch create new plants
      let created = 0
      for (const newPlant of newPlants) {
        try {
          await this.plantRepository.create(newPlant)
          created++
        } catch (error: any) {
          console.error(`[PlantSync] Error creating plant ${newPlant.vendorPlantId}:`, error)
        }
      }

      // Batch update existing plants (25 items per batch)
      const BATCH_SIZE = 25
      let updated = 0

      for (let i = 0; i < plantUpdates.length; i += BATCH_SIZE) {
        const batch = plantUpdates.slice(i, i + BATCH_SIZE)
        try {
          await this.plantRepository.batchUpdate(batch)
          updated += batch.length
        } catch (error: any) {
          console.error(`[PlantSync] Error updating batch:`, error)
          // Fallback: individual updates
          for (const update of batch) {
            try {
              await this.plantRepository.update(update.id, update.updates)
              updated++
            } catch (individualError: any) {
              console.error(`[PlantSync] Error updating plant ${update.id}:`, individualError)
            }
          }
        }
      }

      result.success = true
      result.synced = created + updated
      result.created = created
      result.updated = updated

      const duration = Date.now() - startTime
      console.log(
        `[PlantSync] Vendor ${vendor.name}: ${result.synced}/${result.total} plants synced ` +
        `(${created} created, ${updated} updated) in ${duration}ms`
      )

      // Update last_synced_at timestamp
      if (result.success && result.synced > 0) {
        await this.vendorRepository.update(vendor.id, {
          lastSyncedAt: new Date(),
        })
      }

      return result
    } catch (error: any) {
      console.error(`[PlantSync] Error syncing vendor ${vendor.name}:`, error)
      result.error = error.message || "Unknown error"
      return result
    }
  }
}

