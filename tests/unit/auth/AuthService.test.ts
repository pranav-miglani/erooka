/**
 * AuthService Unit Tests
 * 
 * TDD: Tests written before implementation
 */

import { AuthService } from "../../../src/application/auth/AuthService"
import type { AccountRepository } from "../../../src/domain/account/Account"
import { AuthenticationError, ValidationError } from "../../../src/shared/errors"

describe("AuthService", () => {
  let authService: AuthService
  let mockAccountRepository: jest.Mocked<AccountRepository>

  beforeEach(() => {
    mockAccountRepository = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      findByOrgId: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findAll: jest.fn(),
    }

    authService = new AuthService(mockAccountRepository)
  })

  describe("login", () => {
    it("should throw ValidationError if email is missing", async () => {
      await expect(
        authService.login({ email: "", password: "password123" })
      ).rejects.toThrow(ValidationError)
    })

    it("should throw ValidationError if password is missing", async () => {
      await expect(
        authService.login({ email: "test@example.com", password: "" })
      ).rejects.toThrow(ValidationError)
    })

    it("should throw AuthenticationError if account not found", async () => {
      mockAccountRepository.findByEmail.mockResolvedValue(null)

      await expect(
        authService.login({ email: "test@example.com", password: "password123" })
      ).rejects.toThrow(AuthenticationError)
    })

    it("should throw AuthenticationError if account is inactive", async () => {
      const mockAccount = {
        id: "123",
        email: "test@example.com",
        passwordHash: "$2b$10$hashed",
        accountType: "ORG" as const,
        orgId: 1,
        displayName: null,
        logoUrl: null,
        isActive: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockAccountRepository.findByEmail.mockResolvedValue(mockAccount)

      await expect(
        authService.login({ email: "test@example.com", password: "password123" })
      ).rejects.toThrow(AuthenticationError)
    })

    it("should throw AuthenticationError if password is invalid", async () => {
      const mockAccount = {
        id: "123",
        email: "test@example.com",
        passwordHash: "$2b$10$hashed",
        accountType: "ORG" as const,
        orgId: 1,
        displayName: null,
        logoUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockAccountRepository.findByEmail.mockResolvedValue(mockAccount)

      // Mock bcrypt.compare to return false
      jest.spyOn(require("bcryptjs"), "compare").mockResolvedValue(false)

      await expect(
        authService.login({ email: "test@example.com", password: "wrongpassword" })
      ).rejects.toThrow(AuthenticationError)
    })

    it("should return account and session data on successful login", async () => {
      const mockAccount = {
        id: "123",
        email: "test@example.com",
        passwordHash: "$2b$10$hashed",
        accountType: "ORG" as const,
        orgId: 1,
        displayName: "Test Org",
        logoUrl: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      mockAccountRepository.findByEmail.mockResolvedValue(mockAccount)

      // Mock bcrypt.compare to return true
      jest.spyOn(require("bcryptjs"), "compare").mockResolvedValue(true)

      const result = await authService.login({
        email: "test@example.com",
        password: "password123",
      })

      expect(result.account).toEqual({
        id: "123",
        email: "test@example.com",
        accountType: "ORG",
        orgId: 1,
        displayName: "Test Org",
        logoUrl: null,
        isActive: true,
        createdAt: mockAccount.createdAt,
        updatedAt: mockAccount.updatedAt,
      })

      expect(result.sessionData).toEqual({
        accountId: "123",
        accountType: "ORG",
        orgId: 1,
        email: "test@example.com",
      })

      expect(result.account).not.toHaveProperty("passwordHash")
    })
  })

  describe("createSessionToken", () => {
    it("should create a base64-encoded session token", () => {
      const sessionData = {
        accountId: "123",
        accountType: "ORG" as const,
        orgId: 1,
        email: "test@example.com",
      }

      const token = authService.createSessionToken(sessionData)

      expect(token).toBeTruthy()
      expect(typeof token).toBe("string")

      // Verify it can be decoded
      const decoded = authService.decodeSessionToken(token)
      expect(decoded).toEqual(sessionData)
    })
  })

  describe("decodeSessionToken", () => {
    it("should decode a valid session token", () => {
      const sessionData = {
        accountId: "123",
        accountType: "ORG" as const,
        orgId: 1,
        email: "test@example.com",
      }

      const token = authService.createSessionToken(sessionData)
      const decoded = authService.decodeSessionToken(token)

      expect(decoded).toEqual(sessionData)
    })

    it("should throw AuthenticationError for invalid token", () => {
      expect(() => {
        authService.decodeSessionToken("invalid-token")
      }).toThrow(AuthenticationError)
    })
  })
})

