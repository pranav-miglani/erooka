/**
 * Plants API Handler (Lambda Function)
 * 
 * GET /api/plants - List plants (role-filtered)
 * POST /api/plants - Create plant (SUPERADMIN only)
 * GET /api/plants/[id] - Get single plant
 * PUT /api/plants/[id] - Update plant (SUPERADMIN only)
 * 
 * Based on WOMS plants route implementation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { DynamoDBOrganizationRepository } from "../../../infrastructure/dynamodb/repositories/OrganizationRepository"
import { DynamoDBVendorRepository } from "../../../infrastructure/dynamodb/repositories/VendorRepository"
import { PlantService } from "../../../application/plant/PlantService"
import { AuthService } from "../../../application/auth/AuthService"
import { DynamoDBAccountRepository } from "../../../infrastructure/dynamodb/repositories/AccountRepository"
import { requirePermission } from "../../../shared/rbac/rbac"
import { ValidationError, NotFoundError } from "../../../shared/errors"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const plantRepository = new DynamoDBPlantRepository(dynamoClient)
const orgRepository = new DynamoDBOrganizationRepository(dynamoClient)
const vendorRepository = new DynamoDBVendorRepository(dynamoClient)
const plantService = new PlantService(plantRepository, orgRepository, vendorRepository)
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

export async function getPlantsHandler(
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

    requirePermission(sessionData.accountType, "plants", "read")

    // Role-based filtering
    let plants: any[] = []
    
    if (sessionData.accountType === "ORG" && sessionData.orgId) {
      // ORG users can only see their own org's plants
      plants = await plantService.listPlants(sessionData.orgId)
    } else if (sessionData.accountType === "GOVT") {
      // GOVT users can only see plants mapped to work orders
      // This will be handled in a separate endpoint or via work-order-plants query
      // For now, return empty array (will be implemented with work orders)
      plants = []
    } else {
      // SUPERADMIN can see all plants
      plants = await plantService.listPlants()
    }

    // Include vendor and organization data
    const plantsWithDetails = await Promise.all(
      plants.map(async (plant) => {
        const [org, vendor] = await Promise.all([
          orgRepository.findById(plant.orgId),
          vendorRepository.findById(plant.vendorId),
        ])
        
        return {
          ...plant,
          organizations: org ? { id: org.id, name: org.name } : null,
          vendors: vendor
            ? { id: vendor.id, name: vendor.name, vendor_type: vendor.vendorType }
            : null,
        }
      })
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plants: plantsWithDetails }),
    }
  } catch (error: any) {
    if (error.message?.includes("permission")) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get plants error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function createPlantHandler(
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

    requirePermission(sessionData.accountType, "plants", "create")

    if (!event.body) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Request body is required" }),
      }
    }

    const body = JSON.parse(event.body)
    const plant = await plantService.createPlant({
      orgId: body.org_id,
      vendorId: body.vendor_id,
      vendorPlantId: body.vendor_plant_id,
      name: body.name,
      capacityKw: body.capacity_kw,
      location: body.location || {},
    })

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plant }),
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

    console.error("Create plant error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getPlantHandler(
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

    requirePermission(sessionData.accountType, "plants", "read")

    const plantId = event.pathParameters?.id
    if (!plantId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Plant ID is required" }),
      }
    }

    const plant = await plantService.getPlant(parseInt(plantId))

    // Check permissions - ORG users can only see their own org's plants
    if (sessionData.accountType === "ORG" && sessionData.orgId !== plant.orgId) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden" }),
      }
    }

    // Include vendor and organization data
    const [org, vendor] = await Promise.all([
      orgRepository.findById(plant.orgId),
      vendorRepository.findById(plant.vendorId),
    ])

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...plant,
        organizations: org ? { id: org.id, name: org.name } : null,
        vendors: vendor
          ? { id: vendor.id, name: vendor.name, vendor_type: vendor.vendorType }
          : null,
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

    console.error("Get plant error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function updatePlantHandler(
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

    requirePermission(sessionData.accountType, "plants", "update")

    const plantId = event.pathParameters?.id
    if (!plantId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Plant ID is required" }),
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
    if (body.capacity_kw !== undefined) updates.capacityKw = body.capacity_kw
    if (body.location !== undefined) updates.location = body.location
    if (body.current_power_kw !== undefined) updates.currentPowerKw = body.current_power_kw
    if (body.daily_energy_kwh !== undefined) updates.dailyEnergyKwh = body.daily_energy_kwh
    if (body.monthly_energy_mwh !== undefined) updates.monthlyEnergyMwh = body.monthly_energy_mwh
    if (body.yearly_energy_mwh !== undefined) updates.yearlyEnergyMwh = body.yearly_energy_mwh
    if (body.total_energy_mwh !== undefined) updates.totalEnergyMwh = body.total_energy_mwh
    if (body.is_online !== undefined) updates.isOnline = body.is_online
    if (body.is_active !== undefined) updates.isActive = body.is_active
    if (body.last_update_time !== undefined) {
      updates.lastUpdateTime = body.last_update_time ? new Date(body.last_update_time) : null
    }
    if (body.last_refreshed_at !== undefined) {
      updates.lastRefreshedAt = body.last_refreshed_at ? new Date(body.last_refreshed_at) : null
    }

    const plant = await plantService.updatePlant(parseInt(plantId), updates)

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plant }),
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

    console.error("Update plant error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

