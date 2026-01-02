/**
 * Role-Based Access Control (RBAC)
 * 
 * Based on WOMS RBAC implementation.
 */

import type { AccountType } from "../types"

export interface Permission {
  resource: string
  action: "create" | "read" | "update" | "delete"
}

const ROLE_PERMISSIONS: Record<AccountType, Permission[]> = {
  SUPERADMIN: [
    { resource: "accounts", action: "read" },
    { resource: "organizations", action: "create" },
    { resource: "organizations", action: "read" },
    { resource: "organizations", action: "update" },
    { resource: "organizations", action: "delete" },
    { resource: "vendors", action: "create" },
    { resource: "vendors", action: "read" },
    { resource: "vendors", action: "update" },
    { resource: "vendors", action: "delete" },
    { resource: "plants", action: "create" },
    { resource: "plants", action: "read" },
    { resource: "plants", action: "update" },
    { resource: "plants", action: "delete" },
    { resource: "work_orders", action: "create" },
    { resource: "work_orders", action: "read" },
    { resource: "work_orders", action: "update" },
    { resource: "work_orders", action: "delete" },
    { resource: "alerts", action: "read" },
    { resource: "alerts", action: "update" },
    { resource: "telemetry", action: "read" },
    { resource: "wms_vendors", action: "create" },
    { resource: "wms_vendors", action: "read" },
    { resource: "wms_vendors", action: "update" },
    { resource: "wms_vendors", action: "delete" },
  ],
  DEVELOPER: [
    { resource: "accounts", action: "read" },
    { resource: "organizations", action: "create" },
    { resource: "organizations", action: "read" },
    { resource: "organizations", action: "update" },
    { resource: "organizations", action: "delete" },
    { resource: "vendors", action: "create" },
    { resource: "vendors", action: "read" },
    { resource: "vendors", action: "update" },
    { resource: "vendors", action: "delete" },
    { resource: "plants", action: "create" },
    { resource: "plants", action: "read" },
    { resource: "plants", action: "update" },
    { resource: "plants", action: "delete" },
    { resource: "work_orders", action: "create" },
    { resource: "work_orders", action: "read" },
    { resource: "work_orders", action: "update" },
    { resource: "work_orders", action: "delete" },
    { resource: "alerts", action: "read" },
    { resource: "alerts", action: "update" },
    { resource: "telemetry", action: "read" },
    { resource: "docs", action: "read" },
    { resource: "wms_vendors", action: "create" },
    { resource: "wms_vendors", action: "read" },
    { resource: "wms_vendors", action: "update" },
    { resource: "wms_vendors", action: "delete" },
  ],
  GOVT: [
    { resource: "organizations", action: "read" },
    { resource: "vendors", action: "read" },
    { resource: "plants", action: "read" },
    { resource: "work_orders", action: "read" },
    { resource: "alerts", action: "read" },
    { resource: "telemetry", action: "read" },
    { resource: "wms_vendors", action: "read" },
  ],
  ORG: [
    { resource: "organizations", action: "read" },
    { resource: "vendors", action: "read" },
    { resource: "plants", action: "read" },
    { resource: "work_orders", action: "read" },
    { resource: "alerts", action: "read" },
    { resource: "telemetry", action: "read" },
    { resource: "wms_vendors", action: "read" },
  ],
}

export function hasPermission(
  accountType: AccountType,
  resource: string,
  action: Permission["action"]
): boolean {
  // DEVELOPER is deprecated - treat as SUPERADMIN
  const effectiveAccountType = accountType === "DEVELOPER" ? "SUPERADMIN" : accountType
  const permissions = ROLE_PERMISSIONS[effectiveAccountType] || []
  return permissions.some(
    (p) => p.resource === resource && p.action === action
  )
}

export function requirePermission(
  accountType: AccountType,
  resource: string,
  action: Permission["action"]
): void {
  if (!hasPermission(accountType, resource, action)) {
    throw new Error(
      `Account type ${accountType} does not have permission to ${action} ${resource}`
    )
  }
}

