/**
 * PVBlink Vendor Adapter
 * 
 * Implements PVBlink API integration.
 * Based on WOMS PvBlinkAdapter implementation.
 */

import { BaseVendorAdapter } from "../base/BaseVendorAdapter"
import type { Plant, TelemetryData, Alert, RealtimeData } from "../types"
import { pooledFetch } from "../httpClient"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/lib-dynamodb"

interface PvBlinkAuthResponse {
  data: {
    id: string
    createdOn: string
    updatedOn: string
    activeStatus: string
    firstName: string
    lastName: string
    email: string
    dealerId: string
    mobile: string
    profilePic: string
    isDealer: boolean
    accessToken: string
  }
}

interface PvBlinkPlantResponse {
  data: PvBlinkPlant[]
}

interface PvBlinkPlant {
  id: string
  updatedOn: string
  name: string
  capacity: number
  totalProduction: number
  powerNormalization: number
  dailyProduction: number
  peakHoursToday: number
  alert: string
  isMapped: boolean
  dealerName: string
  noOfDevice: number
  collapse: boolean
  isOnline: boolean
  loggerVersionNo: string
  loggerId: string
  inverterId: string
}

export class PvBlinkAdapter extends BaseVendorAdapter {
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
    return process.env.PVBLINK_API_BASE_URL || "https://cloud.pvblink.com"
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
      console.error("[PVBlink] Error getting token from DB:", error)
      return null
    }
  }

  private async storeTokenInDB(
    token: string,
    expiresIn: number = 11.5 * 60 * 60
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
      console.error("[PVBlink] Error storing token:", error)
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
    const email = credentials.email as string
    const password = credentials.password as string

    if (!email || !password) {
      throw new Error("PVBlink credentials missing: email and password are required")
    }

    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/api/pvblink/user/login`

    const requestBody = {
      email,
      password,
      confirmPassword: null,
      resetPasswordToken: null,
      rememberMe: false,
    }

    try {
      const response = await pooledFetch(url, {
        method: "POST",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
          "Content-Type": "application/json",
          "Origin": baseUrl,
          "Referer": `${baseUrl}/login`,
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
        throw new Error(`PVBlink authentication failed after ${this.MAX_RETRIES} attempts: ${response.statusText} - ${errorText}`)
      }

      const data: PvBlinkAuthResponse = await response.json()

      if (!data.data?.accessToken) {
        if (this.retryCount < this.MAX_RETRIES - 1) {
          this.retryCount++
          await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount))
          return this.authenticateWithRetry()
        }
        throw new Error(`PVBlink authentication failed: No accessToken in response after ${this.MAX_RETRIES} attempts`)
      }

      const defaultExpiresIn = 11.5 * 60 * 60
      await this.storeTokenInDB(data.data.accessToken, defaultExpiresIn)

      this.retryCount = 0
      return data.data.accessToken
    } catch (error: any) {
      if (this.retryCount < this.MAX_RETRIES - 1 && error.message?.includes("fetch")) {
        this.retryCount++
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount))
        return this.authenticateWithRetry()
      }

      if (error.message?.includes("PVBlink authentication failed")) {
        throw error
      }

      throw new Error(`PVBlink authentication error: ${error.message || String(error)}`)
    }
  }

  async listPlant(vendorPlantId: string): Promise<Plant | null> {
    const allPlants = await this.listPlants()
    const plant = allPlants.find((p) => p.id === vendorPlantId)
    return plant || null
  }

  async listPlants(): Promise<Plant[]> {
    const token = await this.authenticate()
    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/api/pvblink/plant/s/all`
    
    const allPlants: Plant[] = []
    let pageNo = 0
    let hasMore = true

    while (hasMore) {
      const pageUrl = `${url}?pageNo=${pageNo}`

      const response = await pooledFetch(pageUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
          "Authorization": token,
          "Content-Type": "application/json",
          "Origin": baseUrl,
          "Referer": `${baseUrl}/app/plant`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to fetch plants from PVBlink (page ${pageNo}): ${response.statusText} - ${errorText}`)
      }

      const data: PvBlinkPlantResponse = await response.json()

      if (!data.data || data.data.length === 0) {
        hasMore = false
        break
      }

      const mappedPlants = data.data.map((plant) => {
        const networkStatus = plant.isOnline ? "ONLINE" : "ALL_OFFLINE"

        return {
          id: plant.id,
          name: plant.name,
          capacityKw: plant.capacity || 0,
          location: undefined,
          metadata: {
            updatedOn: plant.updatedOn,
            totalProduction: plant.totalProduction,
            powerNormalization: plant.powerNormalization,
            dailyProduction: plant.dailyProduction,
            peakHoursToday: plant.peakHoursToday,
            alert: plant.alert,
            isMapped: plant.isMapped,
            dealerName: plant.dealerName,
            noOfDevice: plant.noOfDevice,
            collapse: plant.collapse,
            isOnline: plant.isOnline,
            loggerVersionNo: plant.loggerVersionNo,
            loggerId: plant.loggerId,
            inverterId: plant.inverterId,
            networkStatus,
          },
        }
      })

      allPlants.push(...mappedPlants)
      pageNo++
    }

    return allPlants
  }

  async getTelemetry(
    plantId: string,
    startTime: Date,
    endTime: Date
  ): Promise<TelemetryData[]> {
    console.warn("[PVBlink] getTelemetry() called - not yet implemented. Use getDailyTelemetryRecords for day view.")
    return []
  }

  async getRealtime(plantId: string): Promise<RealtimeData> {
    throw new Error("PVBlink realtime data not yet implemented")
  }

  async getAlerts(plantId: string): Promise<Alert[]> {
    throw new Error("PVBlink alerts not yet implemented")
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
