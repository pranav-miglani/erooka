/**
 * Alert Domain Entity
 * 
 * Represents an alert for a solar plant.
 * Based on WOMS alerts table structure.
 * 
 * High volume time-series data (35K alerts/day = 1M/month).
 * TTL: 180 days (6 months retention).
 */

export type AlertSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
export type AlertStatus = "ACTIVE" | "ACKNOWLEDGED" | "RESOLVED"

export interface Alert {
  id: string
  plantId: number
  vendorId: number
  vendorAlertId: string | null
  title: string
  description: string | null
  severity: AlertSeverity
  status: AlertStatus
  alertTime: Date
  createdAt: Date
  updatedAt: Date
  // TTL for auto-cleanup (alertTime + 180 days)
  ttl: number
}

export interface CreateAlertInput {
  plantId: number
  vendorId: number
  vendorAlertId?: string | null
  title: string
  description?: string | null
  severity: AlertSeverity
  status?: AlertStatus
  alertTime: Date
}

export interface AlertRepository {
  findById(id: string): Promise<Alert | null>
  findByPlantId(plantId: number, limit?: number, status?: AlertStatus): Promise<Alert[]>
  findByVendorAndPlant(vendorId: number, vendorPlantId: string, vendorAlertId: string): Promise<Alert | null>
  create(input: CreateAlertInput): Promise<Alert>
  update(id: string, updates: Partial<Alert>): Promise<Alert>
  batchCreate(inputs: CreateAlertInput[]): Promise<void>
}

