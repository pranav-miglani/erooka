/**
 * FoxessCloud Vendor Adapter
 * 
 * Implements FoxessCloud API integration.
 * Based on WOMS FoxesscloudAdapter implementation.
 * 
 * Note: Most methods are stubs as the API endpoints are not fully documented.
 */

import { BaseVendorAdapter } from "../base/BaseVendorAdapter"
import type { Plant, TelemetryData, Alert, RealtimeData } from "../types"
import { pooledFetch } from "../httpClient"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/lib-dynamodb"

interface FoxesscloudAuthResponse {
  errno: number
  result: {
    token: string
    access: number
    user: string
    weakFlag: boolean
  }
}

export class FoxesscloudAdapter extends BaseVendorAdapter {
  private vendorId?: number
  private dynamoClient?: DynamoDBDocumentClient
  private retryCount: number = 0
  private readonly MAX_RETRIES: number = 3

  setTokenStorage(vendorId: number, dynamoClient: DynamoDBDocumentClient) {
    this.vendorId = vendorId
    this.dynamoClient = dynamoClient
  }

  protected getApiBaseUrl(): string {
    if (this.config.apiBaseUrl) {
      return this.config.apiBaseUrl
    }
    return process.env.FOXESSCLOUD_API_BASE_URL || "https://www.foxesscloud.com"
  }

  private async getTokenFromDB(): Promise<string | null> {
    if (!this.vendorId || !this.dynamoClient) {
      return null
    }

    try {
      const command = new GetItemCommand({
        TableName: "config",
        Key: {
          PK: "VENDOR",
          SK: this.vendorId.toString(),
        },
      })

      const response = await this.dynamoClient.send(command)
      
      if (!response.Item || !response.Item.access_token) {
        return null
      }

      if (response.Item.token_expires_at) {
        const expiresAt = new Date(response.Item.token_expires_at)
        if (expiresAt <= new Date()) {
          return null
        }
      }

      return response.Item.access_token || null
    } catch (error) {
      console.error("[Foxesscloud] Error getting token from DB:", error)
      return null
    }
  }

  private async storeTokenInDB(
    token: string,
    expiresIn: number = 23.5 * 60 * 60
  ): Promise<void> {
    if (!this.vendorId || !this.dynamoClient) {
      return
    }

    try {
      const expiresAt = new Date(Date.now() + expiresIn * 1000)

      const command = new UpdateItemCommand({
        TableName: "config",
        Key: {
          PK: "VENDOR",
          SK: this.vendorId.toString(),
        },
        UpdateExpression: "SET access_token = :token, token_expires_at = :expires, token_metadata = :metadata",
        ExpressionAttributeValues: {
          ":token": token,
          ":expires": expiresAt.toISOString(),
          ":metadata": {
            token_type: "Bearer",
            expires_in: expiresIn,
            stored_at: new Date().toISOString(),
          },
        },
      })

      await this.dynamoClient.send(command)
    } catch (error) {
      console.error("[Foxesscloud] Error storing token:", error)
    }
  }

  async authenticate(): Promise<string> {
    const cachedToken = await this.getTokenFromDB()
    if (cachedToken) {
      return cachedToken
    }

    this.retryCount = 0
    return this.authenticateWithRetry()
  }

  private async authenticateWithRetry(): Promise<string> {
    const credentials = this.getCredentials()
    const username = credentials.username as string
    const passwordMD5 = credentials.passwordMD5 as string

    if (!username || !passwordMD5) {
      throw new Error("Foxesscloud credentials missing: username and passwordMD5 are required")
    }

    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/c/v0/user/login`

    const requestBody = {
      user: username,
      password: passwordMD5,
    }

    const timestamp = Date.now().toString()

    try {
      const response = await pooledFetch(url, {
        method: "POST",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
          "Content-Type": "application/json;charset=UTF-8",
          "contenttype": "application/json",
          "lang": "en",
          "Origin": baseUrl,
          "Referer": `${baseUrl}/login`,
          "timezone": "Asia/Calcutta",
          "timestamp": timestamp,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        if (this.retryCount < this.MAX_RETRIES - 1) {
          this.retryCount++
          await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount))
          return this.authenticateWithRetry()
        }
        throw new Error(`Foxesscloud authentication failed after ${this.MAX_RETRIES} attempts: ${response.statusText} - ${errorText}`)
      }

      const data: FoxesscloudAuthResponse = await response.json()

      if (data.errno !== 0 || !data.result?.token) {
        if (this.retryCount < this.MAX_RETRIES - 1) {
          this.retryCount++
          await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount))
          return this.authenticateWithRetry()
        }
        throw new Error(`Foxesscloud authentication failed: API returned errno ${data.errno} after ${this.MAX_RETRIES} attempts`)
      }

      const defaultExpiresIn = 23.5 * 60 * 60
      await this.storeTokenInDB(data.result.token, defaultExpiresIn)

      this.retryCount = 0
      return data.result.token
    } catch (error: any) {
      if (this.retryCount < this.MAX_RETRIES - 1 && error.message?.includes("fetch")) {
        this.retryCount++
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount))
        return this.authenticateWithRetry()
      }

      if (error.message?.includes("Foxesscloud authentication failed")) {
        throw error
      }

      throw new Error(`Foxesscloud authentication error: ${error.message || String(error)}`)
    }
  }

  async listPlant(vendorPlantId: string): Promise<Plant | null> {
    throw new Error("Foxesscloud plant listing not yet implemented")
  }

  async listPlants(): Promise<Plant[]> {
    throw new Error("Foxesscloud plant listing not yet implemented")
  }

  async getTelemetry(
    plantId: string,
    startTime: Date,
    endTime: Date
  ): Promise<TelemetryData[]> {
    throw new Error("Foxesscloud telemetry not yet implemented")
  }

  async getRealtime(plantId: string): Promise<RealtimeData> {
    throw new Error("Foxesscloud realtime data not yet implemented")
  }

  async getAlerts(plantId: string): Promise<Alert[]> {
    throw new Error("Foxesscloud alerts not yet implemented")
  }

  protected normalizeTelemetry(rawData: any): TelemetryData {
    return {
      plantId: rawData.plantId || "",
      timestamp: new Date(rawData.timestamp || Date.now()),
      generationPowerKw: rawData.generationPowerKw || 0,
    }
  }

  protected normalizeAlert(rawData: any): Alert {
    return {
      vendorAlertId: rawData.id?.toString() || "",
      title: rawData.title || "Alert",
      description: rawData.description || null,
      severity: "MEDIUM",
    }
  }
}
