/**
 * Vendor Adapter Types
 * 
 * Standardized types for vendor adapters.
 * Based on WOMS vendor adapter types.
 */

export interface VendorCredentials {
  [key: string]: string | number | boolean
}

export interface VendorConfig {
  id: number
  name: string
  vendorType: 'SOLARMAN' | 'SOLARDM' | 'SHINEMONITOR' | 'PVBLINK' | 'FOXESSCLOUD' | 'OTHER'
  apiBaseUrl?: string // Optional - can be read from environment variables instead
  credentials: VendorCredentials
  isActive: boolean
  perPlantSyncIntervalMinutes?: number
  plantSyncTimeIst?: string // Daily plant sync time in IST (default: "02:00")
}

/**
 * Standardized Plant interface
 * All vendor adapters must normalize to this format
 */
export interface Plant {
  id: string // Vendor-specific plant ID (vendor_plant_id)
  name: string
  capacityKw: number
  location?: {
    lat?: number
    lng?: number
    address?: string
  }
  metadata?: Record<string, any> // Vendor-specific data (networkStatus, lastUpdateTime, etc.)
}

/**
 * Standardized Telemetry Data interface
 * All vendor adapters must normalize to this format
 */
export interface TelemetryData {
  plantId: string
  timestamp: Date
  generationPowerKw: number
  voltage?: number
  current?: number
  temperature?: number
  irradiance?: number
  efficiencyPct?: number
  metadata?: Record<string, any>
}

/**
 * Standardized Alert interface
 * All vendor adapters must normalize to this format
 */
export interface Alert {
  vendorAlertId?: string
  title: string
  description?: string
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
}

/**
 * Standardized Realtime Data interface
 * All vendor adapters must normalize to this format
 */
export interface RealtimeData {
  plantId: string
  timestamp: Date
  data: Record<string, any>
}

