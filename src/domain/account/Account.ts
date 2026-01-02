/**
 * Account Domain Entity
 * 
 * Represents a user account in the system with role-based access control.
 * Based on WOMS accounts table structure.
 */

export type AccountType = "SUPERADMIN" | "ORG" | "GOVT" | "DEVELOPER" // DEVELOPER is deprecated, treated as SUPERADMIN

export interface Account {
  id: string // UUID
  email: string
  passwordHash: string // bcrypt hash
  accountType: AccountType
  orgId: number | null // null for SUPERADMIN, GOVT (DEVELOPER deprecated, treated as SUPERADMIN)
  displayName: string | null
  logoUrl: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

export interface CreateAccountInput {
  email: string
  password: string // plain text, will be hashed
  accountType: AccountType
  orgId?: number | null
  displayName?: string | null
  logoUrl?: string | null
}

export interface AccountRepository {
  findByEmail(email: string): Promise<Account | null>
  findById(id: string): Promise<Account | null>
  findByOrgId(orgId: number): Promise<Account | null>
  create(input: CreateAccountInput): Promise<Account>
  update(id: string, updates: Partial<Account>): Promise<Account>
  findAll(): Promise<Account[]>
}

