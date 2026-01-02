/**
 * Organization Service
 * 
 * Handles organization management logic.
 * Based on WOMS organizations API implementation.
 */

import type { Organization, OrganizationRepository, CreateOrganizationInput } from "../../domain/organization/Organization"
import { ValidationError, NotFoundError } from "../../shared/errors"

export class OrganizationService {
  constructor(private organizationRepository: OrganizationRepository) {}

  async createOrganization(input: CreateOrganizationInput): Promise<Organization> {
    if (!input.name) {
      throw new ValidationError("Name is required")
    }

    return this.organizationRepository.create(input)
  }

  async getOrganization(id: number): Promise<Organization> {
    const org = await this.organizationRepository.findById(id)
    if (!org) {
      throw new NotFoundError("Organization")
    }
    return org
  }

  async listOrganizations(): Promise<Organization[]> {
    const orgs = await this.organizationRepository.findAll()
    return orgs.sort((a, b) => a.name.localeCompare(b.name))
  }

  async updateOrganization(id: number, updates: Partial<Organization>): Promise<Organization> {
    return this.organizationRepository.update(id, updates)
  }

  async deleteOrganization(id: number): Promise<void> {
    await this.organizationRepository.delete(id)
  }
}

