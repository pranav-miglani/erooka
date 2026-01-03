/**
 * Analytics Service
 * 
 * Provides analytics and insights from plants, alerts, and work orders.
 * Based on WOMS analytics implementation.
 */

import type { PlantRepository, Plant } from "../../domain/plant/Plant"
import type { AlertRepository, Alert } from "../../domain/alert/Alert"
import type { WorkOrderRepository } from "../../domain/workorder/WorkOrder"
import type { WorkOrderPlantRepository } from "../../domain/workorder/WorkOrder"
import type { OrganizationRepository } from "../../domain/organization/Organization"
import type { VendorRepository } from "../../domain/vendor/Vendor"

export interface PlantEnergyReading {
  plantId: number
  date: Date
  dailyEnergyKwh: number
  monthlyEnergyMwh: number
  yearlyEnergyMwh: number
  totalEnergyMwh: number
}

export interface PlantGridDowntime {
  plantId: number
  date: Date
  gridDownHours: number
  gridDownBenefitKwh: number
  alerts: number
}

export interface OrgAnalytics {
  orgId: number
  orgName: string
  totalPlants: number
  activePlants: number
  totalWorkOrders: number
  activeAlerts: number
  production: {
    totalEnergyMwh: number
    dailyEnergyKwh: number
    monthlyEnergyMwh: number
    yearlyEnergyMwh: number
    currentPowerKw: number
    installedCapacityKw: number
  }
}

export interface PlantAnalytics {
  plantId: number
  plantName: string
  vendorName: string
  orgName: string
  production: {
    capacityKw: number
    currentPowerKw: number | null
    dailyEnergyKwh: number | null
    monthlyEnergyMwh: number | null
    yearlyEnergyMwh: number | null
    totalEnergyMwh: number | null
  }
  alerts: {
    total: number
    active: number
    resolved: number
  }
  gridDowntime: {
    totalHours: number
    totalBenefitKwh: number
  }
}

export interface VendorAnalytics {
  vendorId: number
  vendorName: string
  orgName: string
  totalPlants: number
  activePlants: number
  production: {
    totalEnergyMwh: number
    dailyEnergyKwh: number
    monthlyEnergyMwh: number
    yearlyEnergyMwh: number
    currentPowerKw: number
    installedCapacityKw: number
  }
}

export class AnalyticsService {
  constructor(
    private plantRepository: PlantRepository,
    private alertRepository: AlertRepository,
    private workOrderRepository: WorkOrderRepository,
    private workOrderPlantRepository: WorkOrderPlantRepository,
    private organizationRepository: OrganizationRepository,
    private vendorRepository: VendorRepository
  ) {}

  /**
   * Get organization analytics
   */
  async getOrgAnalytics(orgId: number): Promise<OrgAnalytics> {
    const org = await this.organizationRepository.findById(orgId)
    if (!org) {
      throw new Error("Organization not found")
    }

    // Get all plants for this org
    const plants = await this.plantRepository.findByOrgId(orgId)
    const activePlants = plants.filter((p) => p.isActive)

    // Get all work orders for this org
    const workOrders = await this.workOrderRepository.findByOrgId(orgId)

    // Get all active plant mappings
    const allPlantIds = new Set<number>()
    for (const wo of workOrders) {
      const mappings = await this.workOrderPlantRepository.findByWorkOrderIdAndActive(wo.id, true)
      mappings.forEach((m) => allPlantIds.add(m.plantId))
    }

    // Get mapped plants
    const mappedPlantIds = Array.from(allPlantIds)
    const mappedPlants = mappedPlantIds.length > 0
      ? await this.plantRepository.findByPlantIds(mappedPlantIds)
      : []

    // Get active alerts for org plants
    const allPlantIdsArray = plants.map((p) => p.id)
    const activeAlerts: Alert[] = []
    for (const plantId of allPlantIdsArray) {
      const alerts = await this.alertRepository.findByPlantId(plantId, { status: "ACTIVE" })
      activeAlerts.push(...alerts)
    }

    // Aggregate production metrics from mapped plants
    const production = {
      totalEnergyMwh: mappedPlants.reduce((sum, p) => sum + (p.totalEnergyMwh || 0), 0),
      dailyEnergyKwh: mappedPlants.reduce((sum, p) => sum + (p.dailyEnergyKwh || 0), 0),
      monthlyEnergyMwh: mappedPlants.reduce((sum, p) => sum + (p.monthlyEnergyMwh || 0), 0),
      yearlyEnergyMwh: mappedPlants.reduce((sum, p) => sum + (p.yearlyEnergyMwh || 0), 0),
      currentPowerKw: mappedPlants.reduce((sum, p) => sum + (p.currentPowerKw || 0), 0),
      installedCapacityKw: mappedPlants.reduce((sum, p) => sum + (p.capacityKw || 0), 0),
    }

    return {
      orgId: org.id,
      orgName: org.name,
      totalPlants: plants.length,
      activePlants: activePlants.length,
      totalWorkOrders: workOrders.length,
      activeAlerts: activeAlerts.length,
      production,
    }
  }

  /**
   * Get plant analytics
   */
  async getPlantAnalytics(plantId: number): Promise<PlantAnalytics> {
    const plant = await this.plantRepository.findById(plantId)
    if (!plant) {
      throw new Error("Plant not found")
    }

    const [org, vendor, allAlerts] = await Promise.all([
      this.organizationRepository.findById(plant.orgId),
      this.vendorRepository.findById(plant.vendorId),
      this.alertRepository.findByPlantId(plantId),
    ])

    const activeAlerts = allAlerts.filter((a) => a.status === "ACTIVE")
    const resolvedAlerts = allAlerts.filter((a) => a.status === "RESOLVED")

    // Calculate grid downtime from alerts
    const gridDowntimeAlerts = allAlerts.filter((a) => a.gridDownSeconds && a.gridDownSeconds > 0)
    const totalGridDownHours = gridDowntimeAlerts.reduce(
      (sum, a) => sum + ((a.gridDownSeconds || 0) / 3600),
      0
    )
    const totalGridDownBenefitKwh = gridDowntimeAlerts.reduce(
      (sum, a) => sum + (a.gridDownBenefitKwh || 0),
      0
    )

    return {
      plantId: plant.id,
      plantName: plant.name,
      vendorName: vendor?.name || "Unknown",
      orgName: org?.name || "Unknown",
      production: {
        capacityKw: plant.capacityKw,
        currentPowerKw: plant.currentPowerKw,
        dailyEnergyKwh: plant.dailyEnergyKwh,
        monthlyEnergyMwh: plant.monthlyEnergyMwh,
        yearlyEnergyMwh: plant.yearlyEnergyMwh,
        totalEnergyMwh: plant.totalEnergyMwh,
      },
      alerts: {
        total: allAlerts.length,
        active: activeAlerts.length,
        resolved: resolvedAlerts.length,
      },
      gridDowntime: {
        totalHours: totalGridDownHours,
        totalBenefitKwh: totalGridDownBenefitKwh,
      },
    }
  }

  /**
   * Get plant energy readings (time series)
   */
  async getPlantEnergyReadings(
    plantId: number,
    startDate: Date,
    endDate: Date
  ): Promise<PlantEnergyReading[]> {
    const plant = await this.plantRepository.findById(plantId)
    if (!plant) {
      throw new Error("Plant not found")
    }

    // For now, return current plant metrics as a single reading
    // In a full implementation, this would query a time-series table
    // that stores daily snapshots of plant metrics
    return [
      {
        plantId: plant.id,
        date: new Date(),
        dailyEnergyKwh: plant.dailyEnergyKwh || 0,
        monthlyEnergyMwh: plant.monthlyEnergyMwh || 0,
        yearlyEnergyMwh: plant.yearlyEnergyMwh || 0,
        totalEnergyMwh: plant.totalEnergyMwh || 0,
      },
    ]
  }

  /**
   * Get plant grid downtime analytics
   */
  async getPlantGridDowntime(
    plantId: number,
    startDate: Date,
    endDate: Date
  ): Promise<PlantGridDowntime[]> {
    const plant = await this.plantRepository.findById(plantId)
    if (!plant) {
      throw new Error("Plant not found")
    }

    // Get alerts in date range
    const alerts = await this.alertRepository.findByPlantId(plantId)
    const dateRangeAlerts = alerts.filter((a) => {
      const alertDate = a.alertTime
      return alertDate >= startDate && alertDate <= endDate
    })

    // Group by date
    const dailyDowntime = new Map<string, PlantGridDowntime>()
    
    for (const alert of dateRangeAlerts) {
      const dateKey = alert.alertTime.toISOString().split("T")[0]
      const existing = dailyDowntime.get(dateKey) || {
        plantId: plant.id,
        date: new Date(dateKey),
        gridDownHours: 0,
        gridDownBenefitKwh: 0,
        alerts: 0,
      }

      existing.gridDownHours += (alert.gridDownSeconds || 0) / 3600
      existing.gridDownBenefitKwh += alert.gridDownBenefitKwh || 0
      existing.alerts += 1

      dailyDowntime.set(dateKey, existing)
    }

    return Array.from(dailyDowntime.values())
  }

  /**
   * Get vendor analytics
   */
  async getVendorAnalytics(vendorId: number): Promise<VendorAnalytics> {
    const vendor = await this.vendorRepository.findById(vendorId)
    if (!vendor) {
      throw new Error("Vendor not found")
    }

    const org = await this.organizationRepository.findById(vendor.orgId)

    // Get all plants for this vendor
    const plants = await this.plantRepository.findByVendorId(vendorId)
    const activePlants = plants.filter((p) => p.isActive)

    // Aggregate production metrics
    const production = {
      totalEnergyMwh: plants.reduce((sum, p) => sum + (p.totalEnergyMwh || 0), 0),
      dailyEnergyKwh: plants.reduce((sum, p) => sum + (p.dailyEnergyKwh || 0), 0),
      monthlyEnergyMwh: plants.reduce((sum, p) => sum + (p.monthlyEnergyMwh || 0), 0),
      yearlyEnergyMwh: plants.reduce((sum, p) => sum + (p.yearlyEnergyMwh || 0), 0),
      currentPowerKw: plants.reduce((sum, p) => sum + (p.currentPowerKw || 0), 0),
      installedCapacityKw: plants.reduce((sum, p) => sum + (p.capacityKw || 0), 0),
    }

    return {
      vendorId: vendor.id,
      vendorName: vendor.name,
      orgName: org?.name || "Unknown",
      totalPlants: plants.length,
      activePlants: activePlants.length,
      production,
    }
  }

  /**
   * Get all plants analytics
   */
  async getAllPlantsAnalytics(orgId?: number): Promise<PlantAnalytics[]> {
    const plants = orgId
      ? await this.plantRepository.findByOrgId(orgId)
      : await this.plantRepository.findAll()

    const results: PlantAnalytics[] = []
    
    // Process in batches to avoid overwhelming the system
    const BATCH_SIZE = 10
    for (let i = 0; i < plants.length; i += BATCH_SIZE) {
      const batch = plants.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map((plant) => this.getPlantAnalytics(plant.id))
      )
      results.push(...batchResults)
    }

    return results
  }
}

