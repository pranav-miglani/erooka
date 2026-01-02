/**
 * Work Order Service
 * 
 * Handles work order management logic.
 * Based on WOMS work orders API implementation.
 */

import type {
  WorkOrder,
  WorkOrderRepository,
  CreateWorkOrderInput,
  UpdateWorkOrderInput,
  WorkOrderPlantRepository,
} from "../../domain/workorder/WorkOrder"
import { ValidationError, NotFoundError } from "../../shared/errors"
import type { OrganizationRepository } from "../../domain/organization/Organization"
import type { PlantRepository } from "../../domain/plant/Plant"

export class WorkOrderService {
  constructor(
    private workOrderRepository: WorkOrderRepository,
    private workOrderPlantRepository: WorkOrderPlantRepository,
    private organizationRepository: OrganizationRepository,
    private plantRepository: PlantRepository
  ) {}

  async createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
    if (!input.title || !input.plantIds || input.plantIds.length === 0) {
      throw new ValidationError("Title and at least one plant are required")
    }

    // Validate organization exists
    const org = await this.organizationRepository.findById(input.orgId)
    if (!org) {
      throw new NotFoundError("Organization")
    }

    // Validate all plants exist and belong to the same organization
    const plants = await this.plantRepository.findByPlantIds(input.plantIds)
    
    if (plants.length !== input.plantIds.length) {
      throw new ValidationError("One or more plants not found")
    }

    // Check that all plants belong to the same org
    const orgIds = [...new Set(plants.map((p) => p.orgId))]
    if (orgIds.length > 1) {
      throw new ValidationError("All plants must belong to the same organization")
    }

    if (orgIds[0] !== input.orgId) {
      throw new ValidationError("All plants must belong to the specified organization")
    }

    // Create work order
    const workOrder = await this.workOrderRepository.create(input)

    // Deactivate any existing active work orders for these plants
    // (enforce one active work order per plant)
    for (const plantId of input.plantIds) {
      const existingMappings = await this.workOrderPlantRepository.findByPlantId(plantId)
      const activeMappings = existingMappings.filter((m) => m.isActive)
      
      if (activeMappings.length > 0) {
        // Deactivate all active mappings for this plant
        const plantIdsToDeactivate = activeMappings.map((m) => m.plantId)
        await this.workOrderPlantRepository.batchUpdate(
          activeMappings[0].workOrderId,
          plantIdsToDeactivate,
          false
        )
      }
    }

    // Create work order plant mappings
    const mappings = input.plantIds.map((plantId) => ({
      workOrderId: workOrder.id,
      plantId,
      isActive: true,
    }))

    await this.workOrderPlantRepository.batchCreate(mappings)

    return workOrder
  }

  async getWorkOrder(id: number): Promise<WorkOrder> {
    const workOrder = await this.workOrderRepository.findById(id)
    if (!workOrder) {
      throw new NotFoundError("Work order")
    }
    return workOrder
  }

  async listWorkOrders(orgId?: number): Promise<WorkOrder[]> {
    if (orgId) {
      return this.workOrderRepository.findByOrgId(orgId)
    }
    return this.workOrderRepository.findAll()
  }

  async updateWorkOrder(id: number, updates: UpdateWorkOrderInput): Promise<WorkOrder> {
    const existing = await this.getWorkOrder(id)

    // If plantIds are being updated, validate them
    if (updates.plantIds) {
      if (updates.plantIds.length === 0) {
        throw new ValidationError("At least one plant is required")
      }

      // Validate all plants exist and belong to the same organization
      const plants = await this.plantRepository.findByPlantIds(updates.plantIds)
      
      if (plants.length !== updates.plantIds.length) {
        throw new ValidationError("One or more plants not found")
      }

      // Check that all plants belong to the same org as work order
      const orgIds = [...new Set(plants.map((p) => p.orgId))]
      if (orgIds.length > 1 || orgIds[0] !== existing.orgId) {
        throw new ValidationError(
          "All plants must belong to the same organization as the work order"
        )
      }

      // Get existing mappings
      const existingMappings = await this.workOrderPlantRepository.findByWorkOrderId(id)
      const existingPlantIds = new Set(existingMappings.map((m) => m.plantId))
      const selectedPlantIdsSet = new Set(updates.plantIds)

      // Separate plants into: to insert (new), to activate (existing but inactive), to deactivate (not in selection)
      const plantsToInsert: number[] = []
      const plantsToActivate: number[] = []
      const plantsToDeactivate: number[] = []

      // Process selected plants
      for (const plantId of updates.plantIds) {
        if (existingPlantIds.has(plantId)) {
          const existingMapping = existingMappings.find((m) => m.plantId === plantId)
          if (existingMapping && !existingMapping.isActive) {
            plantsToActivate.push(plantId)
          }
        } else {
          plantsToInsert.push(plantId)
        }
      }

      // Process existing plants that are not in the selection
      for (const mapping of existingMappings) {
        if (!selectedPlantIdsSet.has(mapping.plantId) && mapping.isActive) {
          plantsToDeactivate.push(mapping.plantId)
        }
      }

      // Deactivate plants that are no longer selected
      if (plantsToDeactivate.length > 0) {
        await this.workOrderPlantRepository.batchUpdate(id, plantsToDeactivate, false)
      }

      // Activate plants that were previously inactive
      if (plantsToActivate.length > 0) {
        await this.workOrderPlantRepository.batchUpdate(id, plantsToActivate, true)
      }

      // Insert new plants
      if (plantsToInsert.length > 0) {
        // Deactivate any existing active work orders for new plants
        for (const plantId of plantsToInsert) {
          const existingActiveMappings = await this.workOrderPlantRepository.findByPlantId(plantId)
          const activeMappings = existingActiveMappings.filter((m) => m.isActive && m.workOrderId !== id)
          
          if (activeMappings.length > 0) {
            await this.workOrderPlantRepository.batchUpdate(
              activeMappings[0].workOrderId,
              [plantId],
              false
            )
          }
        }

        const newMappings = plantsToInsert.map((plantId) => ({
          workOrderId: id,
          plantId,
          isActive: true,
        }))

        await this.workOrderPlantRepository.batchCreate(newMappings)
      }
    }

    // Update work order (excluding plantIds - handled separately)
    const { plantIds, ...workOrderUpdates } = updates
    return this.workOrderRepository.update(id, workOrderUpdates)
  }

  async deleteWorkOrder(id: number): Promise<void> {
    await this.getWorkOrder(id) // Verify exists
    await this.workOrderRepository.delete(id)
    // Note: Work order plant mappings should be deleted via cascade or separately
  }

  async getWorkOrderPlants(workOrderId: number, activeOnly: boolean = true): Promise<number[]> {
    const mappings = activeOnly
      ? await this.workOrderPlantRepository.findByWorkOrderIdAndActive(workOrderId, true)
      : await this.workOrderPlantRepository.findByWorkOrderId(workOrderId)
    
    return mappings.map((m) => m.plantId)
  }

  async getWorkOrderProductionMetrics(workOrderId: number): Promise<{
    totalPlants: number
    aggregated: {
      installedCapacityKw: number
      currentPowerKw: number
      dailyEnergyKwh: number
      monthlyEnergyMwh: number
      yearlyEnergyMwh: number
      totalEnergyMwh: number
    }
    plants: Array<{
      id: number
      name: string
      capacityKw: number
      currentPowerKw: number | null
      dailyEnergyKwh: number | null
      monthlyEnergyMwh: number | null
      yearlyEnergyMwh: number | null
      totalEnergyMwh: number | null
      lastUpdateTime: Date | null
    }>
  }> {
    const plantIds = await this.getWorkOrderPlants(workOrderId, true)
    
    if (plantIds.length === 0) {
      return {
        totalPlants: 0,
        aggregated: {
          installedCapacityKw: 0,
          currentPowerKw: 0,
          dailyEnergyKwh: 0,
          monthlyEnergyMwh: 0,
          yearlyEnergyMwh: 0,
          totalEnergyMwh: 0,
        },
        plants: [],
      }
    }

    const plants = await this.plantRepository.findByPlantIds(plantIds)

    // Aggregate metrics
    const aggregated = {
      installedCapacityKw: plants.reduce((sum, p) => sum + (p.capacityKw || 0), 0),
      currentPowerKw: plants.reduce((sum, p) => sum + (p.currentPowerKw || 0), 0),
      dailyEnergyKwh: plants.reduce((sum, p) => sum + (p.dailyEnergyKwh || 0), 0),
      monthlyEnergyMwh: plants.reduce((sum, p) => sum + (p.monthlyEnergyMwh || 0), 0),
      yearlyEnergyMwh: plants.reduce((sum, p) => sum + (p.yearlyEnergyMwh || 0), 0),
      totalEnergyMwh: plants.reduce((sum, p) => sum + (p.totalEnergyMwh || 0), 0),
    }

    return {
      totalPlants: plants.length,
      aggregated,
      plants: plants.map((p) => ({
        id: p.id,
        name: p.name,
        capacityKw: p.capacityKw,
        currentPowerKw: p.currentPowerKw,
        dailyEnergyKwh: p.dailyEnergyKwh,
        monthlyEnergyMwh: p.monthlyEnergyMwh,
        yearlyEnergyMwh: p.yearlyEnergyMwh,
        totalEnergyMwh: p.totalEnergyMwh,
        lastUpdateTime: p.lastUpdateTime,
      })),
    }
  }
}

