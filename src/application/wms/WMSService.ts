/**
 * WMS Service
 * 
 * Handles WMS management logic.
 * Based on WOMS WMS API implementation.
 */

import type {
  WMSVendor,
  WMSVendorRepository,
  CreateWMSVendorInput,
  WMSSite,
  WMSSiteRepository,
  CreateWMSSiteInput,
  WMSDevice,
  WMSDeviceRepository,
  CreateWMSDeviceInput,
  InsolationReading,
  InsolationReadingRepository,
  CreateInsolationReadingInput,
} from "../../domain/wms/WMS"
import { ValidationError, NotFoundError } from "../../shared/errors"
import type { OrganizationRepository } from "../../domain/organization/Organization"

export class WMSService {
  constructor(
    private wmsVendorRepository: WMSVendorRepository,
    private wmsSiteRepository: WMSSiteRepository,
    private wmsDeviceRepository: WMSDeviceRepository,
    private insolationReadingRepository: InsolationReadingRepository,
    private organizationRepository: OrganizationRepository
  ) {}

  // WMS Vendor methods
  async createWMSVendor(input: CreateWMSVendorInput): Promise<WMSVendor> {
    if (!input.name || !input.vendorType || !input.credentials || !input.orgId) {
      throw new ValidationError("name, vendor_type, credentials, and org_id are required")
    }

    // Validate vendor type
    if (!["INTELLO", "SCADA", "TRACKSO", "OTHER"].includes(input.vendorType)) {
      throw new ValidationError(`Unsupported WMS vendor type: ${input.vendorType}`)
    }

    // Validate organization exists
    const org = await this.organizationRepository.findById(input.orgId)
    if (!org) {
      throw new NotFoundError("Organization")
    }

    // Validate credentials based on vendor type
    if (input.vendorType === "INTELLO") {
      if (!input.credentials.email || !input.credentials.password_hash) {
        throw new ValidationError("INTELLO requires email and password_hash in credentials")
      }
    } else if (input.vendorType === "SCADA") {
      if (!input.credentials.loginId || !input.credentials.password || !input.credentials.userName || !input.credentials.userType) {
        throw new ValidationError("SCADA requires loginId, password, userName, and userType in credentials")
      }
    }

    return this.wmsVendorRepository.create(input)
  }

  async getWMSVendor(id: number): Promise<WMSVendor> {
    const vendor = await this.wmsVendorRepository.findById(id)
    if (!vendor) {
      throw new NotFoundError("WMS vendor")
    }
    return vendor
  }

  async listWMSVendors(orgId?: number): Promise<WMSVendor[]> {
    if (orgId) {
      return this.wmsVendorRepository.findByOrgId(orgId)
    }
    return this.wmsVendorRepository.findAll()
  }

  async updateWMSVendor(id: number, updates: Partial<WMSVendor>): Promise<WMSVendor> {
    return this.wmsVendorRepository.update(id, updates)
  }

  async deleteWMSVendor(id: number): Promise<void> {
    await this.wmsVendorRepository.delete(id)
  }

  // WMS Site methods
  async createWMSSite(input: CreateWMSSiteInput): Promise<WMSSite> {
    if (!input.wmsVendorId || !input.orgId || !input.vendorSiteId || !input.siteName) {
      throw new ValidationError("wms_vendor_id, org_id, vendor_site_id, and site_name are required")
    }

    // Validate vendor exists
    const vendor = await this.wmsVendorRepository.findById(input.wmsVendorId)
    if (!vendor) {
      throw new NotFoundError("WMS vendor")
    }

    // Validate vendor belongs to organization
    if (vendor.orgId !== input.orgId) {
      throw new ValidationError("WMS vendor does not belong to the specified organization")
    }

    // Check if site already exists
    const existing = await this.wmsSiteRepository.findByVendorAndVendorSiteId(
      input.wmsVendorId,
      input.vendorSiteId
    )
    if (existing) {
      throw new ValidationError(
        `WMS site with vendor_site_id '${input.vendorSiteId}' already exists for this vendor`
      )
    }

    return this.wmsSiteRepository.create(input)
  }

  async getWMSSite(id: number): Promise<WMSSite> {
    const site = await this.wmsSiteRepository.findById(id)
    if (!site) {
      throw new NotFoundError("WMS site")
    }
    return site
  }

  async listWMSSites(vendorId?: number, orgId?: number): Promise<WMSSite[]> {
    if (vendorId) {
      return this.wmsSiteRepository.findByVendorId(vendorId)
    }
    if (orgId) {
      return this.wmsSiteRepository.findByOrgId(orgId)
    }
    return []
  }

  async updateWMSSite(id: number, updates: Partial<WMSSite>): Promise<WMSSite> {
    return this.wmsSiteRepository.update(id, updates)
  }

  async deleteWMSSite(id: number): Promise<void> {
    await this.wmsSiteRepository.delete(id)
  }

  // WMS Device methods
  async createWMSDevice(input: CreateWMSDeviceInput): Promise<WMSDevice> {
    if (!input.wmsSiteId || !input.vendorDeviceId) {
      throw new ValidationError("wms_site_id and vendor_device_id are required")
    }

    // Validate site exists
    const site = await this.wmsSiteRepository.findById(input.wmsSiteId)
    if (!site) {
      throw new NotFoundError("WMS site")
    }

    // Check if device already exists
    const existing = await this.wmsDeviceRepository.findBySiteAndVendorDeviceId(
      input.wmsSiteId,
      input.vendorDeviceId
    )
    if (existing) {
      throw new ValidationError(
        `WMS device with vendor_device_id '${input.vendorDeviceId}' already exists for this site`
      )
    }

    // Get vendor_id from site for GSI1
    const vendor = await this.wmsVendorRepository.findById(site.wmsVendorId)
    if (!vendor) {
      throw new NotFoundError("WMS vendor")
    }

    return this.wmsDeviceRepository.create(input, vendor.id)
  }

  async getWMSDevice(id: number): Promise<WMSDevice> {
    const device = await this.wmsDeviceRepository.findById(id)
    if (!device) {
      throw new NotFoundError("WMS device")
    }
    return device
  }

  async listWMSDevices(siteId?: number, vendorId?: number): Promise<WMSDevice[]> {
    if (siteId) {
      return this.wmsDeviceRepository.findBySiteId(siteId)
    }
    if (vendorId) {
      return this.wmsDeviceRepository.findByVendorId(vendorId)
    }
    return []
  }

  async updateWMSDevice(id: number, updates: Partial<WMSDevice>): Promise<WMSDevice> {
    // Get existing device to get vendor_id
    const existing = await this.getWMSDevice(id)
    const site = await this.wmsSiteRepository.findById(existing.wmsSiteId)
    if (!site) {
      throw new NotFoundError("WMS site")
    }
    const vendor = await this.wmsVendorRepository.findById(site.wmsVendorId)
    if (!vendor) {
      throw new NotFoundError("WMS vendor")
    }

    return this.wmsDeviceRepository.update(id, updates, vendor.id)
  }

  async deleteWMSDevice(id: number): Promise<void> {
    await this.wmsDeviceRepository.delete(id)
  }

  // Insolation Reading methods
  async createInsolationReading(input: CreateInsolationReadingInput): Promise<InsolationReading> {
    if (!input.wmsDeviceId || !input.readingDate || input.insolationValue === undefined || input.readingCount === undefined) {
      throw new ValidationError("wms_device_id, reading_date, insolation_value, and reading_count are required")
    }

    // Validate device exists
    const device = await this.wmsDeviceRepository.findById(input.wmsDeviceId)
    if (!device) {
      throw new NotFoundError("WMS device")
    }

    return this.insolationReadingRepository.create(input)
  }

  async listInsolationReadings(
    deviceId?: number,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100
  ): Promise<InsolationReading[]> {
    if (deviceId) {
      return this.insolationReadingRepository.findByDeviceId(deviceId, startDate, endDate, limit)
    }
    if (startDate) {
      return this.insolationReadingRepository.findByDate(startDate)
    }
    return []
  }

  async batchCreateInsolationReadings(inputs: CreateInsolationReadingInput[]): Promise<void> {
    await this.insolationReadingRepository.batchCreate(inputs)
  }
}

