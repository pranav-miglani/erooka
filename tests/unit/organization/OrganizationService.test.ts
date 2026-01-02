/**
 * OrganizationService Unit Tests
 * 
 * TDD: Tests written before implementation
 */

import { OrganizationService } from "../../../src/application/organization/OrganizationService"
import type { OrganizationRepository } from "../../../src/domain/organization/Organization"
import { ValidationError, NotFoundError } from "../../../src/shared/errors"

describe("OrganizationService", () => {
  let orgService: OrganizationService
  let mockOrgRepository: jest.Mocked<OrganizationRepository>

  beforeEach(() => {
    mockOrgRepository = {
      findById: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    }

    orgService = new OrganizationService(mockOrgRepository)
  })

  describe("createOrganization", () => {
    it("should throw ValidationError if name is missing", async () => {
      await expect(
        orgService.createOrganization({ name: "" })
      ).rejects.toThrow(ValidationError)
    })

    it("should create organization with valid input", async () => {
      const mockOrg = {
        id: 1,
        name: "Test Org",
        autoSyncEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockOrgRepository.create.mockResolvedValue(mockOrg)

      const result = await orgService.createOrganization({ name: "Test Org" })

      expect(result).toEqual(mockOrg)
      expect(mockOrgRepository.create).toHaveBeenCalledWith({ name: "Test Org" })
    })
  })

  describe("getOrganization", () => {
    it("should throw NotFoundError if organization not found", async () => {
      mockOrgRepository.findById.mockResolvedValue(null)

      await expect(orgService.getOrganization(1)).rejects.toThrow(NotFoundError)
    })

    it("should return organization if found", async () => {
      const mockOrg = {
        id: 1,
        name: "Test Org",
        autoSyncEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockOrgRepository.findById.mockResolvedValue(mockOrg)

      const result = await orgService.getOrganization(1)

      expect(result).toEqual(mockOrg)
    })
  })

  describe("listOrganizations", () => {
    it("should return sorted list of organizations", async () => {
      const mockOrgs = [
        { id: 2, name: "Z Org", autoSyncEnabled: null, createdAt: new Date(), updatedAt: new Date() },
        { id: 1, name: "A Org", autoSyncEnabled: true, createdAt: new Date(), updatedAt: new Date() },
      ]

      mockOrgRepository.findAll.mockResolvedValue(mockOrgs)

      const result = await orgService.listOrganizations()

      expect(result[0].name).toBe("A Org")
      expect(result[1].name).toBe("Z Org")
    })
  })

  describe("updateOrganization", () => {
    it("should update organization", async () => {
      const existing = {
        id: 1,
        name: "Test Org",
        autoSyncEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const updated = {
        ...existing,
        autoSyncEnabled: false,
        updatedAt: new Date(),
      }

      mockOrgRepository.findById.mockResolvedValue(existing)
      mockOrgRepository.update.mockResolvedValue(updated)

      const result = await orgService.updateOrganization(1, { autoSyncEnabled: false })

      expect(result.autoSyncEnabled).toBe(false)
    })
  })

  describe("deleteOrganization", () => {
    it("should delete organization", async () => {
      const existing = {
        id: 1,
        name: "Test Org",
        autoSyncEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockOrgRepository.findById.mockResolvedValue(existing)
      mockOrgRepository.delete.mockResolvedValue(undefined)

      await orgService.deleteOrganization(1)

      expect(mockOrgRepository.delete).toHaveBeenCalledWith(1)
    })
  })
})

