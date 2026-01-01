/**
 * Login API Handler (Lambda Function)
 * 
 * POST /api/login
 * 
 * Based on WOMS login route implementation.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { AuthService } from "../../../application/auth/AuthService"
import { DynamoDBAccountRepository } from "../../../infrastructure/dynamodb/repositories/AccountRepository"
import { ValidationError, AuthenticationError } from "../../../shared/errors"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const accountRepository = new DynamoDBAccountRepository(dynamoClient)
const authService = new AuthService(accountRepository)

export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    // Parse request body
    if (!event.body) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Email and password are required" }),
      }
    }

    const { email, password } = JSON.parse(event.body)

    // Validate input
    if (!email || !password) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: "Email and password are required" }),
      }
    }

    // Authenticate user
    const loginResult = await authService.login({ email, password })

    // Create session token
    const sessionToken = authService.createSessionToken(loginResult.sessionData)

    // Return response with Set-Cookie header
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 7}`, // 7 days
      },
      body: JSON.stringify({
        account: loginResult.account,
      }),
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error instanceof AuthenticationError) {
      return {
        statusCode: 401,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ error: error.message }),
      }
    }

    // Log error
    console.error("Login error:", error)

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

