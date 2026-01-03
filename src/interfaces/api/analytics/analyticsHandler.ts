/**
 * Analytics API Handler (Lambda Function)
 * 
 * GET /api/analytics/orgs - Get organization analytics
 * GET /api/analytics/plants - Get all plants analytics
 * GET /api/analytics/plants/[id]/energy - Get plant energy readings
 * GET /api/analytics/plants/[id]/grid-downtime - Get plant grid downtime
 * GET /api/analytics/vendors - Get vendor analytics
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { DynamoDBAlertRepository } from "../../../infrastructure/dynamodb/repositories/AlertRepository"
import { DynamoDBWorkOrderRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderRepository"
import { DynamoDBWorkOrderPlantRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderPlantRepository"
import { DynamoDBOrganizationRepository } from "../../../infrastructure/dynamodb/repositories/OrganizationRepository"
import { DynamoDBVendorRepository } from "../../../infrastructure/dynamodb/repositories/VendorRepository"
import { AnalyticsService } from "../../../application/analytics/AnalyticsService"
import { AuthService } from "../../../application/auth/AuthService"
import { DynamoDBAccountRepository } from "../../../infrastructure/dynamodb/repositories/AccountRepository"
import { requirePermission } from "../../../shared/rbac/rbac"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const plantRepository = new DynamoDBPlantRepository(dynamoClient)
const alertRepository = new DynamoDBAlertRepository(dynamoClient)
const workOrderRepository = new DynamoDBWorkOrderRepository(dynamoClient)
const workOrderPlantRepository = new DynamoDBWorkOrderPlantRepository(dynamoClient)
const organizationRepository = new DynamoDBOrganizationRepository(dynamoClient)
const vendorRepository = new DynamoDBVendorRepository(dynamoClient)

const analyticsService = new AnalyticsService(
  plantRepository,
  alertRepository,
  workOrderRepository,
  workOrderPlantRepository,
  organizationRepository,
  vendorRepository
)

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

export async function getOrgAnalyticsHandler(
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

    requirePermission(sessionData.accountType, "analytics", "read")

    const orgId = event.pathParameters?.id
    if (!orgId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Organization ID is required" }),
      }
    }

    // Check permissions - ORG users can only see their own org's analytics
    if (sessionData.accountType === "ORG" && sessionData.orgId !== parseInt(orgId)) {
      return {
        statusCode: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden" }),
      }
    }

    const analytics = await analyticsService.getOrgAnalytics(parseInt(orgId))

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analytics }),
    }
  } catch (error: any) {
    console.error("Get org analytics error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getPlantsAnalyticsHandler(
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

    requirePermission(sessionData.accountType, "analytics", "read")

    const orgId = sessionData.accountType === "ORG" ? sessionData.orgId : undefined
    const analytics = await analyticsService.getAllPlantsAnalytics(orgId)

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analytics }),
    }
  } catch (error: any) {
    console.error("Get plants analytics error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getPlantEnergyHandler(
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

    requirePermission(sessionData.accountType, "analytics", "read")

    const plantId = event.pathParameters?.id
    if (!plantId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Plant ID is required" }),
      }
    }

    const startDateParam = event.queryStringParameters?.startDate
    const endDateParam = event.queryStringParameters?.endDate

    const startDate = startDateParam ? new Date(startDateParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Default: 30 days ago
    const endDate = endDateParam ? new Date(endDateParam) : new Date()

    const readings = await analyticsService.getPlantEnergyReadings(
      parseInt(plantId),
      startDate,
      endDate
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ readings }),
    }
  } catch (error: any) {
    console.error("Get plant energy error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getPlantGridDowntimeHandler(
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

    requirePermission(sessionData.accountType, "analytics", "read")

    const plantId = event.pathParameters?.id
    if (!plantId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Plant ID is required" }),
      }
    }

    const startDateParam = event.queryStringParameters?.startDate
    const endDateParam = event.queryStringParameters?.endDate

    const startDate = startDateParam ? new Date(startDateParam) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // Default: 30 days ago
    const endDate = endDateParam ? new Date(endDateParam) : new Date()

    const downtime = await analyticsService.getPlantGridDowntime(
      parseInt(plantId),
      startDate,
      endDate
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ downtime }),
    }
  } catch (error: any) {
    console.error("Get plant grid downtime error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

export async function getVendorsAnalyticsHandler(
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

    requirePermission(sessionData.accountType, "analytics", "read")

    const vendorId = event.pathParameters?.id
    if (vendorId) {
      // Single vendor analytics
      const analytics = await analyticsService.getVendorAnalytics(parseInt(vendorId))
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analytics }),
      }
    }

    // All vendors analytics
    const vendors = await vendorRepository.findAll()
    const orgId = sessionData.accountType === "ORG" ? sessionData.orgId : undefined
    const filteredVendors = orgId
      ? vendors.filter((v) => v.orgId === orgId)
      : vendors

    const analytics = await Promise.all(
      filteredVendors.map((v) => analyticsService.getVendorAnalytics(v.id))
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analytics }),
    }
  } catch (error: any) {
    console.error("Get vendors analytics error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

