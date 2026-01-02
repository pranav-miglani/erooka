/**
 * Alerts API Handler
 * 
 * Handles GET /api/alerts and PATCH /api/alerts/[id]
 * Based on WOMS alerts API implementation.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBAlertRepository } from "../../../infrastructure/dynamodb/repositories/AlertRepository"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { AlertService } from "../../../application/alert/AlertService"
import { requirePermission } from "../../../shared/rbac/rbac"
import { AuthenticationError, AuthorizationError, ValidationError } from "../../../shared/errors"

// Initialize DynamoDB client (reuse across invocations)
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// Initialize repositories
const alertRepository = new DynamoDBAlertRepository(dynamoClient)
const plantRepository = new DynamoDBPlantRepository(dynamoClient)

// Initialize service
const alertService = new AlertService(alertRepository, plantRepository)

/**
 * Parse session from cookie
 */
function parseSession(event: APIGatewayProxyEvent): {
  accountType: string
  accountId: string
  orgId?: number
} | null {
  const cookies = event.headers.cookie || event.headers.Cookie || ""
  const sessionCookie = cookies
    .split(";")
    .find((c) => c.trim().startsWith("session="))

  if (!sessionCookie) {
    return null
  }

  try {
    const sessionValue = sessionCookie.split("=")[1]
    const sessionData = JSON.parse(Buffer.from(sessionValue, "base64").toString())
    return sessionData
  } catch {
    return null
  }
}

/**
 * GET /api/alerts
 * 
 * Query parameters:
 * - plantId: Filter by plant ID
 * - limit: Maximum number of alerts (default 100, max 200)
 * - status: Filter by status (ACTIVE, ACKNOWLEDGED, RESOLVED)
 */
export async function getAlertsHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const session = parseSession(event)
    if (!session) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    // Check permission
    try {
      requirePermission(session.accountType as any, "alerts", "read")
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        }
      }
      throw error
    }

    const plantIdParam = event.queryStringParameters?.plantId
    const limitParam = event.queryStringParameters?.limit
    const statusParam = event.queryStringParameters?.status

    const limit = limitParam
      ? Math.min(parseInt(limitParam, 10) || 100, 200)
      : 100

    let alerts: any[] = []

    if (plantIdParam) {
      // Query alerts for specific plant
      const plantId = parseInt(plantIdParam, 10)
      if (isNaN(plantId)) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid plantId" }),
        }
      }

      alerts = await alertService.listAlerts(plantId, limit, statusParam)
    } else if (session.accountType === "ORG" && session.orgId) {
      // ORG users: Get alerts for all plants in their organization
      const plants = await plantRepository.findByOrgId(session.orgId)
      const plantIds = plants.map((p) => p.id)

      if (plantIds.length === 0) {
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alerts: [] }),
        }
      }

      // Query alerts for each plant (in parallel)
      const alertPromises = plantIds.map((plantId) =>
        alertService.listAlerts(plantId, limit, statusParam)
      )
      const alertArrays = await Promise.all(alertPromises)
      alerts = alertArrays.flat().sort((a, b) => {
        // Sort by created_at DESC
        return b.createdAt.getTime() - a.createdAt.getTime()
      })

      // Limit total results
      alerts = alerts.slice(0, limit)
    } else {
      // SUPERADMIN/GOVT: Get all alerts (limited by date-index for recent)
      // For now, return empty - would need date-index query implementation
      alerts = []
    }

    // Enrich with plant data
    const plantIds = [...new Set(alerts.map((a) => a.plantId))]
    const plants = await plantRepository.findByPlantIds(plantIds)
    const plantMap = new Map(plants.map((p) => [p.id, p]))

    const enrichedAlerts = alerts.map((alert) => ({
      ...alert,
      plant: plantMap.get(alert.plantId)
        ? {
            id: plantMap.get(alert.plantId)!.id,
            name: plantMap.get(alert.plantId)!.name,
            org_id: plantMap.get(alert.plantId)!.orgId,
          }
        : null,
    }))

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alerts: enrichedAlerts }),
    }
  } catch (error: any) {
    console.error("Alerts API error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * PATCH /api/alerts/[id]
 * 
 * Update alert status (SUPERADMIN only)
 */
export async function updateAlertHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const session = parseSession(event)
    if (!session) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    // Check permission (SUPERADMIN only)
    try {
      requirePermission(session.accountType as any, "alerts", "write")
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        }
      }
      throw error
    }

    const alertId = event.pathParameters?.id
    if (!alertId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Alert ID is required" }),
      }
    }

    const body = JSON.parse(event.body || "{}")
    const { status } = body

    if (!status || !["ACTIVE", "ACKNOWLEDGED", "RESOLVED"].includes(status)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid status" }),
      }
    }

    const updated = await alertService.updateAlert(alertId, { status: status as any })

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert: updated }),
    }
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Update alert error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

