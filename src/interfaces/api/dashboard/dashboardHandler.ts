/**
 * Dashboard API Handler
 * 
 * Aggregates dashboard metrics based on user role.
 * Based on WOMS dashboard API implementation.
 * 
 * Key Principle: Dashboard metrics aggregate from plants mapped to work orders only.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, BatchGetItemCommand } from "@aws-sdk/lib-dynamodb"
import { DynamoDBWorkOrderRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderRepository"
import { DynamoDBWorkOrderPlantRepository } from "../../../infrastructure/dynamodb/repositories/WorkOrderPlantRepository"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { DynamoDBAlertRepository } from "../../../infrastructure/dynamodb/repositories/AlertRepository"
import { requirePermission } from "../../../shared/rbac/rbac"
import { AuthorizationError } from "../../../shared/errors"

// Initialize DynamoDB client (reuse across invocations)
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// Initialize repositories
const workOrderRepository = new DynamoDBWorkOrderRepository(dynamoClient)
const workOrderPlantRepository = new DynamoDBWorkOrderPlantRepository(dynamoClient)
const plantRepository = new DynamoDBPlantRepository(dynamoClient)
const alertRepository = new DynamoDBAlertRepository(dynamoClient)

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
 * GET /api/dashboard
 * 
 * Returns dashboard metrics based on user role.
 * Metrics aggregate from plants mapped to work orders only.
 */
export async function getDashboardHandler(
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

    const accountType = session.accountType
    const orgId = session.orgId

    const dashboardData: any = {
      role: accountType,
      metrics: {},
      widgets: {},
    }

    if (accountType === "SUPERADMIN" || accountType === "GOVT") {
      // SUPERADMIN/GOVT: All work orders across all organizations
      
      // Get all work orders
      const allWorkOrders = await workOrderRepository.findAll()
      const workOrderIds = allWorkOrders.map((wo) => wo.id)

      // Get all active plant mappings
      const allMappings: any[] = []
      for (const woId of workOrderIds) {
        const mappings = await workOrderPlantRepository.findByWorkOrderIdAndActive(woId, true)
        allMappings.push(...mappings)
      }

      // Extract unique plant IDs
      const mappedPlantIds = [...new Set(allMappings.map((m) => m.plantId))]

      // Get all plants (for total count)
      const allPlants = await plantRepository.findAll()
      const totalPlants = allPlants.length

      // Get mapped plants
      const mappedPlants = mappedPlantIds.length
      const unmappedPlants = totalPlants - mappedPlants

      // Get active alerts (SUPERADMIN only, GOVT doesn't show alerts)
      let activeAlerts = 0
      if (accountType === "SUPERADMIN") {
        // Query alerts with status = ACTIVE
        // For now, get all alerts and filter (would need status-index GSI for better performance)
        const allAlerts = await alertRepository.findByPlantId(0, 10000) // Get all alerts
        activeAlerts = allAlerts.filter((a) => a.status === "ACTIVE").length
      }

      // Get mapped plants data for production metrics
      const mappedPlantsData = mappedPlantIds.length > 0
        ? await plantRepository.findByPlantIds(mappedPlantIds)
        : []

      // Aggregate production metrics from mapped plants only
      const totalEnergyMwh = mappedPlantsData.reduce((sum, p) => sum + (p.totalEnergyMwh || 0), 0)
      const dailyEnergyMwh = mappedPlantsData.reduce((sum, p) => sum + ((p.dailyEnergyKwh || 0) / 1000), 0)
      const monthlyEnergyMwh = mappedPlantsData.reduce((sum, p) => sum + (p.monthlyEnergyMwh || 0), 0)
      const yearlyEnergyMwh = mappedPlantsData.reduce((sum, p) => sum + (p.yearlyEnergyMwh || 0), 0)
      const currentPowerKw = mappedPlantsData.reduce((sum, p) => sum + (p.currentPowerKw || 0), 0)
      const installedCapacityKw = mappedPlantsData.reduce((sum, p) => sum + (p.capacityKw || 0), 0)

      dashboardData.metrics = {
        totalPlants,
        unmappedPlants,
        mappedPlants,
        activeAlerts,
        totalWorkOrders: workOrderIds.length,
        totalEnergyMwh,
        dailyEnergyMwh,
        monthlyEnergyMwh,
        yearlyEnergyMwh,
        currentPowerKw,
        installedCapacityKw,
      }

      if (accountType === "SUPERADMIN") {
        dashboardData.widgets = {
          showOrganizations: true,
          showVendors: true,
          showPlants: true,
          showCreateWorkOrder: true,
          showTelemetryChart: false,
          showAlertsFeed: true,
          showWorkOrdersSummary: true,
        }
      } else {
        // GOVT
        dashboardData.widgets = {
          showTelemetryChart: false,
          showAlertsFeed: false,
          showWorkOrdersSummary: true,
          showOrgBreakdown: true,
          showExportCSV: true,
        }
      }
    } else if (accountType === "ORG" && orgId) {
      // ORG: Work orders for the organization only
      
      // Get work orders for org
      const orgWorkOrders = await workOrderRepository.findByOrgId(orgId)
      const workOrderIds = orgWorkOrders.map((wo) => wo.id)

      // Get all active plant mappings for org's work orders
      const allMappings: any[] = []
      for (const woId of workOrderIds) {
        const mappings = await workOrderPlantRepository.findByWorkOrderIdAndActive(woId, true)
        allMappings.push(...mappings)
      }

      // Extract unique plant IDs
      const mappedPlantIds = [...new Set(allMappings.map((m) => m.plantId))]

      // Get all plants for org (for total count)
      const orgPlants = await plantRepository.findByOrgId(orgId)
      const totalPlants = orgPlants.length

      // Get mapped plants
      const mappedPlants = mappedPlantIds.length
      const unmappedPlants = totalPlants - mappedPlants

      // Get active alerts for org plants
      const orgPlantIds = orgPlants.map((p) => p.id)
      let activeAlerts = 0
      if (orgPlantIds.length > 0) {
        const alerts = await Promise.all(
          orgPlantIds.map((pid) => alertRepository.findByPlantId(pid, 100))
        )
        activeAlerts = alerts.flat().filter((a) => a.status === "ACTIVE").length
      }

      // Get mapped plants data for production metrics
      const mappedPlantsData = mappedPlantIds.length > 0
        ? await plantRepository.findByPlantIds(mappedPlantIds)
        : []

      // Aggregate production metrics from mapped plants only
      const totalEnergyMwh = mappedPlantsData.reduce((sum, p) => sum + (p.totalEnergyMwh || 0), 0)

      dashboardData.metrics = {
        totalPlants,
        unmappedPlants,
        mappedPlants,
        activeAlerts,
        totalWorkOrders: workOrderIds.length,
        totalEnergyMwh,
      }

      dashboardData.widgets = {
        showTelemetryChart: false,
        showAlertsFeed: true,
        showWorkOrdersSummary: true,
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dashboardData),
    }
  } catch (error: any) {
    console.error("Dashboard API error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

