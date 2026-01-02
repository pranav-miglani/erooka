/**
 * Get Current User API Handler (Lambda Function)
 * 
 * GET /api/me
 * 
 * Based on WOMS /api/me route implementation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBAccountRepository } from "../../../infrastructure/dynamodb/repositories/AccountRepository"
import { AuthService } from "../../../application/auth/AuthService"
import { AuthenticationError, NotFoundError } from "../../../shared/errors"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const accountRepository = new DynamoDBAccountRepository(dynamoClient)
const authService = new AuthService(accountRepository)

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    // Extract session from cookie
    const cookies = event.headers?.Cookie || event.headers?.cookie || ""
    const sessionMatch = cookies.match(/session=([^;]+)/)
    
    if (!sessionMatch || !sessionMatch[1]) {
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    const sessionToken = sessionMatch[1]

    // Decode session
    let sessionData
    try {
      sessionData = authService.decodeSessionToken(sessionToken)
    } catch (error) {
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Invalid session" }),
      }
    }

    // Verify session has required data
    if (!sessionData.accountId || !sessionData.accountType) {
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Invalid session data" }),
      }
    }

    // Get account to verify it still exists
    const account = await accountRepository.findById(sessionData.accountId)

    if (!account) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Account not found" }),
      }
    }

    // Get SUPERADMIN account for footer (if needed)
    let superAdminLogoUrl = null
    let superAdminDisplayName = null

    // DEVELOPER is deprecated, treated as SUPERADMIN
    if (account.accountType === "SUPERADMIN" || account.accountType === "DEVELOPER") {
      // Use current user's info for footer
      superAdminLogoUrl = account.logoUrl
      superAdminDisplayName = account.displayName
    } else {
      // Get first SUPERADMIN account for footer
      const allAccounts = await accountRepository.findAll()
      const superAdmin = allAccounts.find(
        (a) => a.accountType === "SUPERADMIN" && a.isActive
      )
      superAdminLogoUrl = superAdmin?.logoUrl ?? null
      superAdminDisplayName = superAdmin?.displayName ?? null
    }

    // Return account data (without password hash)
    const { passwordHash, ...accountWithoutPassword } = account

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account: accountWithoutPassword,
        superAdmin: {
          logoUrl: superAdminLogoUrl,
          displayName: superAdminDisplayName,
        },
      }),
    }
  } catch (error) {
    console.error("Get me error:", error)

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

