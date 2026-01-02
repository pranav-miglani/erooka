/**
 * Vendor Service
 * 
 * Handles vendor management logic.
 * Based on WOMS vendors API implementation.
 */

import type { Vendor, VendorRepository, CreateVendorInput } from "../../domain/vendor/Vendor"
import { ValidationError, NotFoundError } from "../../shared/errors"
import type { OrganizationRepository } from "../../domain/organization/Organization"

export class VendorService {
  constructor(
    private vendorRepository: VendorRepository,
    private organizationRepository: OrganizationRepository
  ) {}

  async createVendor(input: CreateVendorInput): Promise<Vendor> {
    if (!input.name || !input.vendorType || !input.orgId) {
      throw new ValidationError("Name, vendor_type, and org_id are required")
    }

    // Validate organization exists
    const org = await this.organizationRepository.findById(input.orgId)
    if (!org) {
      throw new NotFoundError("Organization")
    }

    return this.vendorRepository.create(input)
  }

  async getVendor(id: number): Promise<Vendor> {
    const vendor = await this.vendorRepository.findById(id)
    if (!vendor) {
      throw new NotFoundError("Vendor")
    }
    return vendor
  }

  async listVendors(orgId?: number): Promise<Vendor[]> {
    if (orgId) {
      return this.vendorRepository.findByOrgId(orgId)
    }
    return this.vendorRepository.findAll()
  }

  async updateVendor(id: number, updates: Partial<Vendor>): Promise<Vendor> {
    // If org_id is being updated, validate it exists
    if (updates.orgId !== undefined) {
      const org = await this.organizationRepository.findById(updates.orgId)
      if (!org) {
        throw new NotFoundError("Organization")
      }
    }

    return this.vendorRepository.update(id, updates)
  }

  async deleteVendor(id: number): Promise<void> {
    await this.vendorRepository.delete(id)
  }
}

