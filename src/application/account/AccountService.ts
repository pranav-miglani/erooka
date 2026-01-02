/**
 * Account Service
 * 
 * Handles account creation and management logic.
 * Based on WOMS accounts API implementation.
 */

import type { Account, AccountRepository, CreateAccountInput } from "../../domain/account/Account"
import { AuthService } from "../auth/AuthService"
import { ValidationError, ConflictError } from "../../shared/errors"
import type { AccountType } from "../../shared/types"

export interface CreateAccountRequest {
  email: string
  password: string
  accountType: AccountType
  orgId?: number | null
  displayName?: string | null
  logoUrl?: string | null
}

export class AccountService {
  constructor(
    private accountRepository: AccountRepository,
    private authService: AuthService
  ) {}

  async createAccount(input: CreateAccountRequest): Promise<Omit<Account, "passwordHash">> {
    // Validate required fields
    if (!input.email || !input.password || !input.accountType) {
      throw new ValidationError("Email, password, and account_type are required")
    }

    // Validate account_type - DEVELOPER is deprecated, cannot be created
    if (!["SUPERADMIN", "ORG", "GOVT"].includes(input.accountType)) {
      throw new ValidationError(
        "Invalid account_type. Must be SUPERADMIN, ORG, or GOVT. DEVELOPER is deprecated."
      )
    }

    // Explicitly reject DEVELOPER account creation (deprecated)
    if (input.accountType === "DEVELOPER") {
      throw new ValidationError(
        "DEVELOPER account type is deprecated. Use SUPERADMIN instead."
      )
    }

    // Validate org_id for ORG accounts
    if (input.accountType === "ORG" && !input.orgId) {
      throw new ValidationError("org_id is required for ORG accounts")
    }

    // Validate org_id is null for SUPERADMIN and GOVT
    if (
      (input.accountType === "SUPERADMIN" || input.accountType === "GOVT") &&
      input.orgId
    ) {
      throw new ValidationError("org_id must be null for SUPERADMIN and GOVT accounts")
    }

    // Hash password
    const passwordHash = await this.authService.hashPassword(input.password)

    // Create account
    const account = await this.accountRepository.create({
      email: input.email,
      password: passwordHash,
      accountType: input.accountType,
      orgId: input.orgId ?? null,
      displayName: input.displayName ?? null,
      logoUrl: input.logoUrl ?? null,
    })

    // Return account without password hash
    const { passwordHash: _, ...accountWithoutPassword } = account
    return accountWithoutPassword
  }

  async getAccount(id: string): Promise<Omit<Account, "passwordHash">> {
    const account = await this.accountRepository.findById(id)
    if (!account) {
      throw new Error("Account not found")
    }
    const { passwordHash: _, ...accountWithoutPassword } = account
    return accountWithoutPassword
  }

  async listAccounts(): Promise<Omit<Account, "passwordHash">[]> {
    const accounts = await this.accountRepository.findAll()
    return accounts
      .sort((a, b) => a.email.localeCompare(b.email))
      .map(({ passwordHash: _, ...account }) => account)
  }
}

