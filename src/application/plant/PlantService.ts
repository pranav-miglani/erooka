/**
 * Plant Service
 * 
 * Handles plant management logic.
 * Based on WOMS plants API implementation.
 */

import type {
  Plant,
  PlantRepository,
  CreatePlantInput,
  UpdatePlantInput,
} from "../../domain/plant/Plant"
import { ValidationError, NotFoundError } from "../../shared/errors"
import type { OrganizationRepository } from "../../domain/organization/Organization"
import type { VendorRepository } from "../../domain/vendor/Vendor"

export class PlantService {
  constructor(
    private plantRepository: PlantRepository,
    private organizationRepository: OrganizationRepository,
    private vendorRepository: VendorRepository
  ) {}

  async createPlant(input: CreatePlantInput): Promise<Plant> {
    if (!input.orgId || !input.vendorId || !input.vendorPlantId || !input.name || !input.capacityKw) {
      throw new ValidationError("org_id, vendor_id, vendor_plant_id, name, and capacity_kw are required")
    }

    // Validate organization exists
    const org = await this.organizationRepository.findById(input.orgId)
    if (!org) {
      throw new NotFoundError("Organization")
    }

    // Validate vendor exists
    const vendor = await this.vendorRepository.findById(input.vendorId)
    if (!vendor) {
      throw new NotFoundError("Vendor")
    }

    // Validate vendor belongs to organization
    if (vendor.orgId !== input.orgId) {
      throw new ValidationError("Vendor does not belong to the specified organization")
    }

    // Check if plant already exists (vendor_id + vendor_plant_id unique)
    const existing = await this.plantRepository.findByVendorAndVendorPlantId(
      input.vendorId,
      input.vendorPlantId
    )
    if (existing) {
      throw new ValidationError(
        `Plant with vendor_plant_id '${input.vendorPlantId}' already exists for this vendor`
      )
    }

    return this.plantRepository.create(input)
  }

  async getPlant(id: number): Promise<Plant> {
    const plant = await this.plantRepository.findById(id)
    if (!plant) {
      throw new NotFoundError("Plant")
    }
    return plant
  }

  async listPlants(orgId?: number, vendorId?: number): Promise<Plant[]> {
    if (vendorId) {
      return this.plantRepository.findByVendorId(vendorId)
    }
    if (orgId) {
      return this.plantRepository.findByOrgId(orgId)
    }
    return this.plantRepository.findAll()
  }

  async updatePlant(id: number, updates: UpdatePlantInput): Promise<Plant> {
    return this.plantRepository.update(id, updates)
  }

  async deletePlant(id: number): Promise<void> {
    await this.plantRepository.delete(id)
  }
}

