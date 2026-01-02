/**
 * Alert Service
 * 
 * Handles alert management logic.
 * Based on WOMS alerts API implementation.
 */

import type {
  Alert,
  AlertRepository,
  CreateAlertInput,
} from "../../domain/alert/Alert"
import { ValidationError, NotFoundError } from "../../shared/errors"
import type { PlantRepository } from "../../domain/plant/Plant"

export class AlertService {
  constructor(
    private alertRepository: AlertRepository,
    private plantRepository: PlantRepository
  ) {}

  async getAlert(id: string): Promise<Alert> {
    const alert = await this.alertRepository.findById(id)
    if (!alert) {
      throw new NotFoundError("Alert")
    }
    return alert
  }

  async listAlerts(
    plantId?: number,
    limit: number = 100,
    status?: string
  ): Promise<Alert[]> {
    if (plantId) {
      return this.alertRepository.findByPlantId(plantId, limit, status as any)
    }
    
    // For org-level queries, we'll need to query plants first
    // This will be handled in the API handler
    return []
  }

  async createAlert(input: CreateAlertInput): Promise<Alert> {
    if (!input.plantId || !input.vendorId || !input.title || !input.alertTime) {
      throw new ValidationError("plant_id, vendor_id, title, and alert_time are required")
    }

    // Validate plant exists
    const plant = await this.plantRepository.findById(input.plantId)
    if (!plant) {
      throw new NotFoundError("Plant")
    }

    // Validate plant belongs to vendor
    if (plant.vendorId !== input.vendorId) {
      throw new ValidationError("Plant does not belong to the specified vendor")
    }

    return this.alertRepository.create(input)
  }

  async updateAlert(id: string, updates: Partial<Alert>): Promise<Alert> {
    return this.alertRepository.update(id, updates)
  }

  async batchCreateAlerts(inputs: CreateAlertInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }

    // Validate all plants exist
    const plantIds = [...new Set(inputs.map((i) => i.plantId))]
    const plants = await this.plantRepository.findByPlantIds(plantIds)

    if (plants.length !== plantIds.length) {
      throw new ValidationError("Some plants not found")
    }

    // Validate vendor matches for each alert
    for (const input of inputs) {
      const plant = plants.find((p) => p.id === input.plantId)
      if (!plant || plant.vendorId !== input.vendorId) {
        throw new ValidationError(
          `Plant ${input.plantId} does not belong to vendor ${input.vendorId}`
        )
      }
    }

    await this.alertRepository.batchCreate(inputs)
  }
}

