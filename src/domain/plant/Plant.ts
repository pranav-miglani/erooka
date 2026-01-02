/**
 * Plant Domain Entity
 * 
 * Represents a solar plant in the system.
 * Based on WOMS plants table structure.
 * 
 * Production metrics are stored at plant level and aggregated on-the-fly
 * for work orders and organizations.
 */

export interface Plant {
  id: number
  orgId: number
  vendorId: number
  vendorPlantId: string
  name: string
  capacityKw: number
  location: Record<string, any>
  // Production metrics (updated every 15 minutes)
  currentPowerKw: number | null
  dailyEnergyKwh: number | null
  monthlyEnergyMwh: number | null
  yearlyEnergyMwh: number | null
  totalEnergyMwh: number | null
  isOnline: boolean | null
  isActive: boolean
  lastUpdateTime: Date | null
  lastRefreshedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface CreatePlantInput {
  orgId: number
  vendorId: number
  vendorPlantId: string
  name: string
  capacityKw: number
  location?: Record<string, any>
}

export interface UpdatePlantInput {
  name?: string
  capacityKw?: number
  location?: Record<string, any>
  currentPowerKw?: number | null
  dailyEnergyKwh?: number | null
  monthlyEnergyMwh?: number | null
  yearlyEnergyMwh?: number | null
  totalEnergyMwh?: number | null
  isOnline?: boolean | null
  isActive?: boolean
  lastUpdateTime?: Date | null
  lastRefreshedAt?: Date | null
}

export interface PlantRepository {
  findById(id: number): Promise<Plant | null>
  findByVendorAndVendorPlantId(vendorId: number, vendorPlantId: string): Promise<Plant | null>
  findByOrgId(orgId: number): Promise<Plant[]>
  findByVendorId(vendorId: number): Promise<Plant[]>
  findByPlantIds(plantIds: number[]): Promise<Plant[]>
  findAll(): Promise<Plant[]>
  create(input: CreatePlantInput): Promise<Plant>
  update(id: number, updates: UpdatePlantInput): Promise<Plant>
  batchUpdate(updates: Array<{ id: number; updates: UpdatePlantInput }>): Promise<void>
  delete(id: number): Promise<void>
}

