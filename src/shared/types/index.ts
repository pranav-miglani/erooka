/**
 * Shared Types
 */

export type AccountType = "SUPERADMIN" | "ORG" | "GOVT" | "DEVELOPER" // DEVELOPER is deprecated, treated as SUPERADMIN

export interface SessionData {
  accountId: string
  accountType: AccountType
  orgId: number | null
  email: string
}

export interface ApiResponse<T = any> {
  data?: T
  error?: string
  message?: string
}

