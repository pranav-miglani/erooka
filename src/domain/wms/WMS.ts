/**
 * WMS (Weather Monitoring System) Domain Entities
 * 
 * WMS is a separate domain from solar plants.
 * Entities: WMS Vendors, WMS Sites, WMS Devices, Insolation Readings
 * 
 * Based on WOMS WMS tables structure.
 */

export type WMSVendorType = "INTELLO" | "SCADA" | "TRACKSO" | "OTHER"

export interface WMSVendor {
  id: number
  name: string
  vendorType: WMSVendorType
  credentials: Record<string, any>
  orgId: number
  accessToken?: string | null
  refreshToken?: string | null
  tokenExpiresAt?: Date | null
  tokenMetadata?: Record<string, any>
  isActive: boolean
  lastSitesSyncedAt?: Date | null
  lastInsolationSyncedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateWMSVendorInput {
  name: string
  vendorType: WMSVendorType
  credentials: Record<string, any>
  orgId: number
  isActive?: boolean
}

export interface WMSSite {
  id: number
  wmsVendorId: number
  orgId: number
  vendorSiteId: string
  siteName: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  location?: string | null
  elevation?: number | null
  status?: string | null
  panelCount?: number | null
  panelWattage?: number | null
  createdDate?: Date | null
  installerType?: string | null
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface CreateWMSSiteInput {
  wmsVendorId: number
  orgId: number
  vendorSiteId: string
  siteName: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  location?: string | null
  elevation?: number | null
  status?: string | null
  panelCount?: number | null
  panelWattage?: number | null
  createdDate?: Date | null
  installerType?: string | null
  metadata?: Record<string, any>
}

export interface WMSDevice {
  id: number
  wmsSiteId: number
  vendorDeviceId: string
  deviceName?: string | null
  macAddress?: string | null
  serialNo?: string | null
  metadata?: Record<string, any>
  createdAt: Date
  updatedAt: Date
}

export interface CreateWMSDeviceInput {
  wmsSiteId: number
  vendorDeviceId: string
  deviceName?: string | null
  macAddress?: string | null
  serialNo?: string | null
  metadata?: Record<string, any>
}

export interface InsolationReading {
  id: string // Composite: device_id#date
  wmsDeviceId: number
  readingDate: Date
  insolationValue: number // Daily insolation in kWh/m²
  readingCount: number // Number of readings for this day
  ttl: number // TTL: reading_date + 100 days
  createdAt: Date
  updatedAt: Date
}

export interface CreateInsolationReadingInput {
  wmsDeviceId: number
  readingDate: Date
  insolationValue: number
  readingCount: number
}

// Repository interfaces
export interface WMSVendorRepository {
  findById(id: number): Promise<WMSVendor | null>
  findByOrgId(orgId: number): Promise<WMSVendor[]>
  findAll(): Promise<WMSVendor[]>
  create(input: CreateWMSVendorInput): Promise<WMSVendor>
  update(id: number, updates: Partial<WMSVendor>): Promise<WMSVendor>
  delete(id: number): Promise<void>
}

export interface WMSSiteRepository {
  findById(id: number): Promise<WMSSite | null>
  findByVendorId(vendorId: number): Promise<WMSSite[]>
  findByOrgId(orgId: number): Promise<WMSSite[]>
  findByVendorAndVendorSiteId(vendorId: number, vendorSiteId: string): Promise<WMSSite | null>
  create(input: CreateWMSSiteInput): Promise<WMSSite>
  update(id: number, updates: Partial<WMSSite>): Promise<WMSSite>
  delete(id: number): Promise<void>
}

export interface WMSDeviceRepository {
  findById(id: number): Promise<WMSDevice | null>
  findBySiteId(siteId: number): Promise<WMSDevice[]>
  findByVendorId(vendorId: number): Promise<WMSDevice[]>
  findBySiteAndVendorDeviceId(siteId: number, vendorDeviceId: string): Promise<WMSDevice | null>
  create(input: CreateWMSDeviceInput): Promise<WMSDevice>
  update(id: number, updates: Partial<WMSDevice>): Promise<WMSDevice>
  delete(id: number): Promise<void>
}

export interface InsolationReadingRepository {
  findByDeviceId(deviceId: number, startDate?: Date, endDate?: Date, limit?: number): Promise<InsolationReading[]>
  findByDate(date: Date): Promise<InsolationReading[]>
  findByDeviceAndDate(deviceId: number, date: Date): Promise<InsolationReading | null>
  create(input: CreateInsolationReadingInput): Promise<InsolationReading>
  batchCreate(inputs: CreateInsolationReadingInput[]): Promise<void>
}

