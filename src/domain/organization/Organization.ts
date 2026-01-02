/**
 * Organization Domain Entity
 * 
 * Represents an organization in the system.
 * Based on WOMS organizations table structure.
 */

export interface Organization {
  id: number
  name: string
  autoSyncEnabled: boolean | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateOrganizationInput {
  name: string
  autoSyncEnabled?: boolean | null
}

export interface OrganizationRepository {
  findById(id: number): Promise<Organization | null>
  findAll(): Promise<Organization[]>
  create(input: CreateOrganizationInput): Promise<Organization>
  update(id: number, updates: Partial<Organization>): Promise<Organization>
  delete(id: number): Promise<void>
}

