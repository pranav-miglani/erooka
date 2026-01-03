/**
 * WMS Sync Service
 * 
 * Syncs WMS sites and insolation readings from WMS vendors.
 * 
 * Note: WMS adapters are not yet implemented, so this service provides
 * a structure that can be extended when WMS adapters are available.
 */

import type { WMSVendorRepository, WMSVendor } from "../../domain/wms/WMS"
import type { WMSSiteRepository, WMSSite, CreateWMSSiteInput } from "../../domain/wms/WMS"
import type { WMSDeviceRepository, WMSDevice, CreateWMSDeviceInput } from "../../domain/wms/WMS"
import type { InsolationReadingRepository, InsolationReading, CreateInsolationReadingInput } from "../../domain/wms/WMS"

export interface WMSSiteSyncResult {
  vendorId: number
  vendorName: string
  orgId: number
  success: boolean
  synced: number
  created: number
  updated: number
  total: number
  error?: string
}

export interface WMSInsolationSyncResult {
  vendorId: number
  vendorName: string
  orgId: number
  success: boolean
  synced: number
  created: number
  total: number
  error?: string
}

export class WMSSyncService {
  constructor(
    private wmsVendorRepository: WMSVendorRepository,
    private wmsSiteRepository: WMSSiteRepository,
    private wmsDeviceRepository: WMSDeviceRepository,
    private insolationReadingRepository: InsolationReadingRepository
  ) {}

  /**
   * Sync sites for all active WMS vendors
   */
  async syncAllVendorSites(): Promise<WMSSiteSyncResult[]> {
    const vendors = await this.wmsVendorRepository.findAll()
    const activeVendors = vendors.filter((v) => v.isActive)

    console.log(`[WMSSiteSync] Starting sync for ${activeVendors.length} active WMS vendors`)

    const results: WMSSiteSyncResult[] = []
    
    for (const vendor of activeVendors) {
      const result = await this.syncVendorSites(vendor)
      results.push(result)
    }

    return results
  }

  /**
   * Sync sites for a single WMS vendor
   * 
   * Note: This is a stub implementation. When WMS adapters are implemented,
   * this will call the adapter to fetch sites from the vendor API.
   */
  async syncVendorSites(vendor: WMSVendor): Promise<WMSSiteSyncResult> {
    const startTime = Date.now()
    const result: WMSSiteSyncResult = {
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
      console.log(`[WMSSiteSync] Syncing vendor ${vendor.id} (${vendor.name})`)

      // TODO: When WMS adapters are implemented, call:
      // const adapter = WMSAdapterManager.getAdapter(vendor.vendorType)
      // const vendorSites = await adapter.listSites()
      
      // For now, return success with no sites
      result.success = true
      result.total = 0

      // Update last_sites_synced_at
      await this.wmsVendorRepository.update(vendor.id, {
        lastSitesSyncedAt: new Date(),
      })

      const duration = Date.now() - startTime
      console.log(
        `[WMSSiteSync] Vendor ${vendor.name}: ${result.synced}/${result.total} sites synced ` +
        `(${result.created} created, ${result.updated} updated) in ${duration}ms`
      )

      return result
    } catch (error: any) {
      console.error(`[WMSSiteSync] Error syncing vendor ${vendor.name}:`, error)
      result.error = error.message || "Unknown error"
      return result
    }
  }

  /**
   * Sync insolation readings for all active WMS vendors
   */
  async syncAllVendorInsolation(): Promise<WMSInsolationSyncResult[]> {
    const vendors = await this.wmsVendorRepository.findAll()
    const activeVendors = vendors.filter((v) => v.isActive)

    console.log(`[WMSInsolationSync] Starting sync for ${activeVendors.length} active WMS vendors`)

    const results: WMSInsolationSyncResult[] = []
    
    for (const vendor of activeVendors) {
      const result = await this.syncVendorInsolation(vendor)
      results.push(result)
    }

    return results
  }

  /**
   * Sync insolation readings for a single WMS vendor
   * 
   * Note: This is a stub implementation. When WMS adapters are implemented,
   * this will call the adapter to fetch insolation readings from the vendor API.
   */
  async syncVendorInsolation(vendor: WMSVendor): Promise<WMSInsolationSyncResult> {
    const startTime = Date.now()
    const result: WMSInsolationSyncResult = {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orgId: vendor.orgId,
      success: false,
      synced: 0,
      created: 0,
      total: 0,
    }

    try {
      console.log(`[WMSInsolationSync] Syncing vendor ${vendor.id} (${vendor.name})`)

      // Get all devices for this vendor
      const devices = await this.wmsDeviceRepository.findByVendorId(vendor.id)
      
      if (devices.length === 0) {
        result.success = true
        result.total = 0
        return result
      }

      // TODO: When WMS adapters are implemented, call:
      // const adapter = WMSAdapterManager.getAdapter(vendor.vendorType)
      // for (const device of devices) {
      //   const readings = await adapter.getInsolationReadings(device.vendorDeviceId, startDate, endDate)
      //   // Batch create readings
      // }

      // For now, return success with no readings
      result.success = true
      result.total = 0

      // Update last_insolation_synced_at
      await this.wmsVendorRepository.update(vendor.id, {
        lastInsolationSyncedAt: new Date(),
      })

      const duration = Date.now() - startTime
      console.log(
        `[WMSInsolationSync] Vendor ${vendor.name}: ${result.synced} readings synced ` +
        `(${result.created} created) in ${duration}ms`
      )

      return result
    } catch (error: any) {
      console.error(`[WMSInsolationSync] Error syncing vendor ${vendor.name}:`, error)
      result.error = error.message || "Unknown error"
      return result
    }
  }
}

