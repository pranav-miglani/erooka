/**
 * Vendor Domain Entity
 * 
 * Represents a vendor in the system.
 * Based on WOMS vendors table structure.
 */

export type VendorType = "SOLARMAN" | "SOLARDM" | "SHINEMONITOR" | "PVBLINK" | "FOXESSCLOUD"
export type PlantSyncMode = "MANUAL" | "SCHEDULED" | "REALTIME"
export type TelemetrySyncMode = "MANUAL" | "SCHEDULED" | "REALTIME"

export interface Vendor {
  id: number
  name: string
  vendorType: VendorType
  credentials: Record<string, any>
  orgId: number
  isActive: boolean
  plantSyncMode: PlantSyncMode | null
  perPlantSyncIntervalMinutes: number | null
  plantSyncTimeIst: string | null
  telemetrySyncMode: TelemetrySyncMode | null
  telemetrySyncInterval: number | null
  lastSyncedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateVendorInput {
  name: string
  vendorType: VendorType
  credentials: Record<string, any>
  orgId: number
  isActive?: boolean
  plantSyncMode?: PlantSyncMode | null
  perPlantSyncIntervalMinutes?: number | null
  plantSyncTimeIst?: string | null
  telemetrySyncMode?: TelemetrySyncMode | null
  telemetrySyncInterval?: number | null
}

export interface VendorRepository {
  findById(id: number): Promise<Vendor | null>
  findAll(): Promise<Vendor[]>
  findByOrgId(orgId: number): Promise<Vendor[]>
  create(input: CreateVendorInput): Promise<Vendor>
  update(id: number, updates: Partial<Vendor>): Promise<Vendor>
  delete(id: number): Promise<void>
}

