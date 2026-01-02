/**
 * Vendors API Handler (Lambda Function)
 * 
 * GET /api/vendors - List all vendors
 * POST /api/vendors - Create vendor (SUPERADMIN/DEVELOPER only)
 * GET /api/vendors/[id] - Get single vendor
 * PUT /api/vendors/[id] - Update vendor (SUPERADMIN/DEVELOPER only)
 * DELETE /api/vendors/[id] - Delete vendor (SUPERADMIN/DEVELOPER only)
 * 
 * Based on WOMS vendors route implementation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBVendorRepository } from "../../../infrastructure/dynamodb/repositories/VendorRepository"
import { DynamoDBOrganizationRepository } from "../../../infrastructure/dynamodb/repositories/OrganizationRepository"
import { VendorService } from "../../../application/vendor/VendorService"
import { AuthService } from "../../../application/auth/AuthService"
import { DynamoDBAccountRepository } from "../../../infrastructure/dynamodb/repositories/AccountRepository"
import { requirePermission } from "../../../shared/rbac/rbac"
import { ValidationError, NotFoundError } from "../../../shared/errors"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const vendorRepository = new DynamoDBVendorRepository(dynamoClient)
const orgRepository = new DynamoDBOrganizationRepository(dynamoClient)
const vendorService = new VendorService(vendorRepository, orgRepository)
const accountRepository = new DynamoDBAccountRepository(dynamoClient)
const authService = new AuthService(accountRepository)

function extractSession(event: APIGatewayProxyEvent): any {
  const cookies = event.headers?.Cookie || event.headers?.cookie || ""
  const sessionMatch = cookies.match(/session=([^;]+)/)
  
  if (!sessionMatch || !sessionMatch[1]) {
    return null
  }

  try {
    return authService.decodeSessionToken(sessionMatch[1])
  } catch {
    return null
  }
}

export async function getVendorsHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const sessionData = extractSession(event)
    
    if (!sessionData) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    requirePermission(sessionData.accountType, "vendors", "read")

    // Filter by org_id for ORG users
    const orgId = sessionData.accountType === "ORG" ? sessionData.orgId : undefined
    const vendors = await vendorService.listVendors(orgId)

    // For each vendor, include organization data
    const vendorsWithOrgs = await Promise.all(
      vendors.map(async (vendor) => {
        const org = await orgRepository.findById(vendor.orgId)
        return {
          ...vendor,
          organizations: org ? { id: org.id, name: org.name } : null,
        }
      })
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendors: vendorsWithOrgs }),
    }
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get vendors error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function createVendorHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const sessionData = extractSession(event)
    
    if (!sessionData) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    requirePermission(sessionData.accountType, "vendors", "create")

    if (!event.body) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Request body is required" }),
      }
    }

    const body = JSON.parse(event.body)
    const vendor = await vendorService.createVendor({
      name: body.name,
      vendorType: body.vendor_type,
      credentials: body.credentials,
      orgId: body.org_id,
      isActive: body.is_active ?? true,
      plantSyncMode: body.plant_sync_mode ?? null,
      perPlantSyncIntervalMinutes: body.per_plant_sync_interval_minutes ?? null,
      plantSyncTimeIst: body.plant_sync_time_ist ?? null,
      telemetrySyncMode: body.telemetry_sync_mode ?? null,
      telemetrySyncInterval: body.telemetry_sync_interval ?? null,
    })

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor }),
    }
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Create vendor error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getVendorHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const sessionData = extractSession(event)
    
    if (!sessionData) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    requirePermission(sessionData.accountType, "vendors", "read")

    const vendorId = event.pathParameters?.id
    if (!vendorId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Vendor ID is required" }),
      }
    }

    const vendor = await vendorService.getVendor(parseInt(vendorId))
    const org = await orgRepository.findById(vendor.orgId)

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vendor: {
          ...vendor,
          organizations: org ? { id: org.id, name: org.name } : null,
        },
      }),
    }
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get vendor error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function updateVendorHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const sessionData = extractSession(event)
    
    if (!sessionData) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    requirePermission(sessionData.accountType, "vendors", "update")

    const vendorId = event.pathParameters?.id
    if (!vendorId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Vendor ID is required" }),
      }
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Request body is required" }),
      }
    }

    const body = JSON.parse(event.body)
    const updates: any = {}

    if (body.name !== undefined) updates.name = body.name
    if (body.credentials !== undefined) updates.credentials = body.credentials
    if (body.is_active !== undefined) updates.isActive = Boolean(body.is_active)
    if (body.org_id !== undefined) updates.orgId = body.org_id
    if (body.plant_sync_mode !== undefined) updates.plantSyncMode = body.plant_sync_mode
    if (body.per_plant_sync_interval_minutes !== undefined) {
      updates.perPlantSyncIntervalMinutes = body.per_plant_sync_interval_minutes
    }
    if (body.plant_sync_time_ist !== undefined) {
      updates.plantSyncTimeIst = body.plant_sync_time_ist
    }
    if (body.telemetry_sync_mode !== undefined) {
      updates.telemetrySyncMode = body.telemetry_sync_mode
    }
    if (body.telemetry_sync_interval !== undefined) {
      updates.telemetrySyncInterval = body.telemetry_sync_interval
    }

    const vendor = await vendorService.updateVendor(parseInt(vendorId), updates)

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor }),
    }
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Update vendor error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function deleteVendorHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const sessionData = extractSession(event)
    
    if (!sessionData) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    requirePermission(sessionData.accountType, "vendors", "delete")

    const vendorId = event.pathParameters?.id
    if (!vendorId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Vendor ID is required" }),
      }
    }

    await vendorService.deleteVendor(parseInt(vendorId))

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true }),
    }
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Delete vendor error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

