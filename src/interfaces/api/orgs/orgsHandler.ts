/**
 * Organizations API Handler (Lambda Function)
 * 
 * GET /api/orgs - List all organizations
 * POST /api/orgs - Create organization (SUPERADMIN only)
 * 
 * Based on WOMS orgs route implementation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBOrganizationRepository } from "../../../infrastructure/dynamodb/repositories/OrganizationRepository"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { DynamoDBWorkOrderRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderRepository"
import { DynamoDBWorkOrderPlantRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderPlantRepository"
import { OrganizationService } from "../../../application/organization/OrganizationService"
import { PlantService } from "../../../application/plant/PlantService"
import { AuthService } from "../../../application/auth/AuthService"
import { DynamoDBAccountRepository } from "../../../infrastructure/dynamodb/repositories/AccountRepository"
import { requirePermission } from "../../../shared/rbac/rbac"
import { ValidationError } from "../../../shared/errors"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const orgRepository = new DynamoDBOrganizationRepository(dynamoClient)
const plantRepository = new DynamoDBPlantRepository(dynamoClient)
const workOrderRepository = new DynamoDBWorkOrderRepository(dynamoClient)
const workOrderPlantRepository = new DynamoDBWorkOrderPlantRepository(dynamoClient)
const orgService = new OrganizationService(orgRepository)
const plantService = new PlantService(plantRepository, orgRepository, null as any) // vendorRepository not needed for org plants
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

export async function getOrganizationsHandler(
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

    requirePermission(sessionData.accountType, "organizations", "read")

    const orgs = await orgService.listOrganizations()

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgs }),
    }
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get organizations error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function createOrganizationHandler(
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

    requirePermission(sessionData.accountType, "organizations", "create")

    if (!event.body) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Request body is required" }),
      }
    }

    const body = JSON.parse(event.body)
    const org = await orgService.createOrganization({ name: body.name })

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org }),
    }
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
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

    console.error("Create organization error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getOrganizationHandler(
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

    const orgId = event.pathParameters?.id
    if (!orgId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Organization ID is required" }),
      }
    }

    const org = await orgService.getOrganization(parseInt(orgId))

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org }),
    }
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get organization error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function updateOrganizationHandler(
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

    requirePermission(sessionData.accountType, "organizations", "update")

    const orgId = event.pathParameters?.id
    if (!orgId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Organization ID is required" }),
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
    
    if (body.autoSyncEnabled !== undefined) {
      updates.autoSyncEnabled = Boolean(body.autoSyncEnabled)
    }

    const org = await orgService.updateOrganization(parseInt(orgId), updates)

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, organization: org }),
    }
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error.message?.includes("not found")) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Update organization error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function deleteOrganizationHandler(
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

    requirePermission(sessionData.accountType, "organizations", "delete")

    const orgId = event.pathParameters?.id
    if (!orgId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Organization ID is required" }),
      }
    }

    await orgService.deleteOrganization(parseInt(orgId))

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, message: "Organization deleted successfully" }),
    }
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error.message?.includes("not found")) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Delete organization error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getOrganizationPlantsHandler(
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

    requirePermission(sessionData.accountType, "organizations", "read")

    const orgId = event.pathParameters?.id
    if (!orgId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Organization ID is required" }),
      }
    }

    // Check permissions - ORG users can only see their own org's plants
    if (sessionData.accountType === "ORG" && sessionData.orgId !== parseInt(orgId)) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden" }),
      }
    }

    const plants = await plantService.listPlants(parseInt(orgId))

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plants }),
    }
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get organization plants error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getOrganizationProductionHandler(
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

    requirePermission(sessionData.accountType, "organizations", "read")

    const orgId = event.pathParameters?.id
    if (!orgId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Organization ID is required" }),
      }
    }

    // Check permissions - ORG users can only see their own org's production
    if (sessionData.accountType === "ORG" && sessionData.orgId !== parseInt(orgId)) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden" }),
      }
    }

    // Get all work orders for this organization
    const workOrders = await workOrderRepository.findByOrgId(parseInt(orgId))
    
    // Get all active plant mappings for these work orders
    const allPlantIds = new Set<number>()
    for (const wo of workOrders) {
      const mappings = await workOrderPlantRepository.findByWorkOrderIdAndActive(wo.id, true)
      mappings.forEach((m) => allPlantIds.add(m.plantId))
    }

    if (allPlantIds.size === 0) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalWorkOrders: workOrders.length,
          totalPlants: 0,
          aggregated: {
            installedCapacityKw: 0,
            currentPowerKw: 0,
            dailyEnergyKwh: 0,
            monthlyEnergyMwh: 0,
            yearlyEnergyMwh: 0,
            totalEnergyMwh: 0,
          },
        }),
      }
    }

    // Get all plants
    const plantIdsArray = Array.from(allPlantIds)
    const plants = await plantRepository.findByPlantIds(plantIdsArray)

    // Aggregate metrics
    const aggregated = {
      installedCapacityKw: plants.reduce((sum, p) => sum + (p.capacityKw || 0), 0),
      currentPowerKw: plants.reduce((sum, p) => sum + (p.currentPowerKw || 0), 0),
      dailyEnergyKwh: plants.reduce((sum, p) => sum + (p.dailyEnergyKwh || 0), 0),
      monthlyEnergyMwh: plants.reduce((sum, p) => sum + (p.monthlyEnergyMwh || 0), 0),
      yearlyEnergyMwh: plants.reduce((sum, p) => sum + (p.yearlyEnergyMwh || 0), 0),
      totalEnergyMwh: plants.reduce((sum, p) => sum + (p.totalEnergyMwh || 0), 0),
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalWorkOrders: workOrders.length,
        totalPlants: plants.length,
        aggregated,
      }),
    }
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get organization production error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

