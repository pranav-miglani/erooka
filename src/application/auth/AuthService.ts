/**
 * Authentication Service
 * 
 * Handles authentication logic: login, session creation, password hashing.
 * Based on WOMS login implementation.
 */

import bcrypt from "bcryptjs"
import type { Account, AccountRepository } from "../../domain/account/Account"
import { AuthenticationError, ValidationError } from "../../shared/errors"
import type { SessionData } from "../../shared/types"

export interface LoginInput {
  email: string
  password: string
}

export interface LoginResult {
  account: Omit<Account, "passwordHash">
  sessionData: SessionData
}

export class AuthService {
  constructor(private accountRepository: AccountRepository) {}

  async login(input: LoginInput): Promise<LoginResult> {
    // Validate input
    if (!input.email || !input.password) {
      throw new ValidationError("Email and password are required")
    }

    // Find account by email
    const account = await this.accountRepository.findByEmail(input.email)
    
    if (!account) {
      throw new AuthenticationError("Invalid credentials")
    }

    if (!account.isActive) {
      throw new AuthenticationError("Account is inactive")
    }

    // Verify password
    const isValid = await this.verifyPassword(input.password, account.passwordHash)
    
    if (!isValid) {
      throw new AuthenticationError("Invalid credentials")
    }

    // Create session data
    const sessionData: SessionData = {
      accountId: account.id,
      accountType: account.accountType,
      orgId: account.orgId,
      email: account.email,
    }

    // Return account without password hash
    const { passwordHash, ...accountWithoutPassword } = account

    return {
      account: accountWithoutPassword,
      sessionData,
    }
  }

  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10)
  }

  private async verifyPassword(
    plainPassword: string,
    hashedPassword: string
  ): Promise<boolean> {
    // Check if stored password is a bcrypt hash
    const isBcryptHash = hashedPassword.match(/^\$2[ayb]\$.{56}$/)
    
    if (isBcryptHash) {
      return bcrypt.compare(plainPassword, hashedPassword)
    }
    
    // Fallback: plain text comparison (for backward compatibility during migration)
    return plainPassword === hashedPassword
  }

  createSessionToken(sessionData: SessionData): string {
    return Buffer.from(JSON.stringify(sessionData)).toString("base64")
  }

  decodeSessionToken(token: string): SessionData {
    try {
      return JSON.parse(Buffer.from(token, "base64").toString())
    } catch (error) {
      throw new AuthenticationError("Invalid session token")
    }
  }
}

