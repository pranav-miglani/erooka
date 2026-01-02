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
import { OrganizationService } from "../../../application/organization/OrganizationService"
import { AuthService } from "../../../application/auth/AuthService"
import { DynamoDBAccountRepository } from "../../../infrastructure/dynamodb/repositories/AccountRepository"
import { requirePermission } from "../../../shared/rbac/rbac"
import { ValidationError, AuthorizationError } from "../../../shared/errors"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const orgRepository = new DynamoDBOrganizationRepository(dynamoClient)
const orgService = new OrganizationService(orgRepository)
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

