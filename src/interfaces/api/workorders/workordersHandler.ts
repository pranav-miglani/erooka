/**
 * Work Orders API Handler
 * 
 * Handles work order CRUD operations.
 * Based on WOMS work orders API implementation.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBWorkOrderRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderRepository"
import { DynamoDBWorkOrderPlantRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderPlantRepository"
import { DynamoDBOrganizationRepository } from "../../../infrastructure/dynamodb/repositories/OrganizationRepository"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { WorkOrderService } from "../../../application/workorder/WorkOrderService"
import { requirePermission } from "../../../shared/rbac/rbac"
import { AuthenticationError, AuthorizationError, ValidationError, NotFoundError } from "../../../shared/errors"

// Initialize DynamoDB client (reuse across invocations)
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// Initialize repositories
const workOrderRepository = new DynamoDBWorkOrderRepository(dynamoClient)
const workOrderPlantRepository = new DynamoDBWorkOrderPlantRepository(dynamoClient)
const organizationRepository = new DynamoDBOrganizationRepository(dynamoClient)
const plantRepository = new DynamoDBPlantRepository(dynamoClient)

// Initialize service
const workOrderService = new WorkOrderService(
  workOrderRepository,
  workOrderPlantRepository,
  organizationRepository,
  plantRepository
)

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
 * GET /api/workorders
 * 
 * Query parameters:
 * - orgId: Filter by organization ID
 */
export async function getWorkOrdersHandler(
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
      requirePermission(session.accountType as any, "work_orders", "read")
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

    const orgIdParam = event.queryStringParameters?.orgId
    const targetOrgId = orgIdParam ? parseInt(orgIdParam, 10) : undefined

    let workOrders: any[] = []

    if (targetOrgId) {
      // Filter by orgId query parameter
      workOrders = await workOrderService.listWorkOrders(targetOrgId)
    } else if (session.accountType === "ORG" && session.orgId) {
      // ORG users: Only see their organization's work orders
      workOrders = await workOrderService.listWorkOrders(session.orgId)
    } else {
      // SUPERADMIN/GOVT: See all work orders
      workOrders = await workOrderService.listWorkOrders()
    }

    // Enrich with plant data and organization data
    const enrichedWorkOrders = await Promise.all(
      workOrders.map(async (wo) => {
        const plantIds = await workOrderService.getWorkOrderPlants(wo.id, true)
        const plants = plantIds.length > 0
          ? await plantRepository.findByPlantIds(plantIds)
          : []

        const org = await organizationRepository.findById(wo.orgId)

        return {
          id: wo.id,
          title: wo.title,
          description: wo.description,
          created_at: wo.createdAt.toISOString(),
          updated_at: wo.updatedAt.toISOString(),
          org_id: wo.orgId,
          wms_device_id: wo.wmsDeviceId,
          organizations: org
            ? {
                id: org.id,
                name: org.name,
              }
            : null,
          work_order_plants: plants.map((p) => ({
            plant_id: p.id,
            plants: {
              id: p.id,
              name: p.name,
              org_id: p.orgId,
              capacity_kw: p.capacityKw,
            },
          })),
        }
      })
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workOrders: enrichedWorkOrders }),
    }
  } catch (error: any) {
    console.error("Work orders API error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * POST /api/workorders
 * 
 * Create a new work order (SUPERADMIN only)
 */
export async function createWorkOrderHandler(
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
      requirePermission(session.accountType as any, "work_orders", "create")
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

    const body = JSON.parse(event.body || "{}")
    const { title, description, plantIds, wmsDeviceId } = body

    if (!title || !plantIds || plantIds.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Title and at least one plant are required" }),
      }
    }

    // Validate plants to get orgId
    const plants = await plantRepository.findByPlantIds(plantIds)
    
    if (plants.length !== plantIds.length) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "One or more plants not found" }),
      }
    }

    const orgIds = [...new Set(plants.map((p) => p.orgId))]
    if (orgIds.length > 1) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "All plants must belong to the same organization" }),
      }
    }

    const orgId = orgIds[0]

    // TODO: Validate WMS device if provided (requires WMS repository)
    // For now, skip WMS device validation

    const workOrder = await workOrderService.createWorkOrder({
      title,
      description: description || null,
      orgId,
      plantIds,
      wmsDeviceId: wmsDeviceId || null,
      createdBy: session.accountId,
    })

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workOrder }),
    }
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Create work order error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * GET /api/workorders/[id]
 * 
 * Get a single work order
 */
export async function getWorkOrderHandler(
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
      requirePermission(session.accountType as any, "work_orders", "read")
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

    const workOrderId = event.pathParameters?.id
    if (!workOrderId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Work order ID is required" }),
      }
    }

    const id = parseInt(workOrderId, 10)
    if (isNaN(id)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid work order ID" }),
      }
    }

    const workOrder = await workOrderService.getWorkOrder(id)

    // Enforce org scoping for ORG users
    if (session.accountType === "ORG" && session.orgId) {
      if (workOrder.orgId !== session.orgId) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Not found" }),
        }
      }
    }

    // Get plants
    const plantIds = await workOrderService.getWorkOrderPlants(id, false)
    const plants = plantIds.length > 0
      ? await plantRepository.findByPlantIds(plantIds)
      : []

    // Get organization
    const org = await organizationRepository.findById(workOrder.orgId)

    // TODO: Get WMS device if assigned (requires WMS repository)
    // For now, skip WMS device

    const enrichedWorkOrder = {
      id: workOrder.id,
      title: workOrder.title,
      description: workOrder.description,
      created_at: workOrder.createdAt.toISOString(),
      updated_at: workOrder.updatedAt.toISOString(),
      org_id: workOrder.orgId,
      wms_device_id: workOrder.wmsDeviceId,
      work_order_plants: plants.map((p) => ({
        plant_id: p.id,
        is_active: plantIds.includes(p.id), // Simplified - should check actual mapping
        plants: {
          id: p.id,
          name: p.name,
          org_id: p.orgId,
          capacity_kw: p.capacityKw,
          organizations: org
            ? {
                id: org.id,
                name: org.name,
              }
            : null,
        },
      })),
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workOrder: enrichedWorkOrder }),
    }
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get work order error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * PUT /api/workorders/[id]
 * 
 * Update a work order (SUPERADMIN only)
 */
export async function updateWorkOrderHandler(
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
      requirePermission(session.accountType as any, "work_orders", "update")
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

    const workOrderId = event.pathParameters?.id
    if (!workOrderId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Work order ID is required" }),
      }
    }

    const id = parseInt(workOrderId, 10)
    if (isNaN(id)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid work order ID" }),
      }
    }

    const body = JSON.parse(event.body || "{}")
    const { title, description, plantIds, wmsDeviceId } = body

    if (!title || !plantIds || plantIds.length === 0) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Title and at least one plant are required" }),
      }
    }

    // TODO: Validate WMS device if provided (requires WMS repository)

    const updated = await workOrderService.updateWorkOrder(id, {
      title,
      description: description || null,
      plantIds,
      wmsDeviceId: wmsDeviceId !== undefined ? wmsDeviceId : undefined,
    })

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workOrder: updated }),
    }
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Update work order error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * DELETE /api/workorders/[id]
 * 
 * Delete a work order (SUPERADMIN only)
 */
export async function deleteWorkOrderHandler(
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
      requirePermission(session.accountType as any, "work_orders", "delete")
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

    const workOrderId = event.pathParameters?.id
    if (!workOrderId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Work order ID is required" }),
      }
    }

    const id = parseInt(workOrderId, 10)
    if (isNaN(id)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid work order ID" }),
      }
    }

    await workOrderService.deleteWorkOrder(id)

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        success: true,
        message: "Work order deleted successfully",
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

    console.error("Delete work order error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * GET /api/workorders/[id]/production
 * 
 * Get production metrics for a work order
 */
export async function getWorkOrderProductionHandler(
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
      requirePermission(session.accountType as any, "work_orders", "read")
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

    const workOrderId = event.pathParameters?.id
    if (!workOrderId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Work order ID is required" }),
      }
    }

    const id = parseInt(workOrderId, 10)
    if (isNaN(id)) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid work order ID" }),
      }
    }

    // Verify work order exists and check org scoping
    const workOrder = await workOrderService.getWorkOrder(id)
    
    if (session.accountType === "ORG" && session.orgId) {
      if (workOrder.orgId !== session.orgId) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Not found" }),
        }
      }
    }

    const metrics = await workOrderService.getWorkOrderProductionMetrics(id)

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(metrics),
    }
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Get work order production error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

