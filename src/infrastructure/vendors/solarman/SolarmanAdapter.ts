/**
 * Solarman Vendor Adapter
 * 
 * Implements Solarman API integration.
 * Based on WOMS SolarmanAdapter implementation.
 * 
 * Key Features:
 * - PRO API support (richer data)
 * - Token caching in DynamoDB
 * - Comprehensive logging
 * - Plant listing with live telemetry
 * - Alert fetching
 */

import { BaseVendorAdapter } from "../base/BaseVendorAdapter"
import type { Plant, TelemetryData, Alert, RealtimeData } from "../types"
import { pooledFetch } from "../httpClient"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/lib-dynamodb"

interface SolarmanAuthResponse {
  access_token: string
  token_type: string
  expires_in: number
}

interface SolarmanStation {
  stationId: number
  stationName: string
  capacity: number
  location?: {
    latitude?: number
    longitude?: number
    address?: string
  }
}

interface SolarmanStationListResponse {
  data: SolarmanStation[]
  success: boolean
}

interface SolarmanRealtimeResponse {
  data: {
    stationId: number
    currentPower: number
    todayEnergy: number
    totalEnergy: number
    voltage?: number
    current?: number
    temperature?: number
    [key: string]: any
  }
  success: boolean
}

interface SolarmanAlert {
  alertId: string
  stationId: number
  alertType: string
  alertLevel: number
  message: string
  timestamp: string
  [key: string]: any
}

interface SolarmanAlertsResponse {
  data: SolarmanAlert[]
  success: boolean
}

interface SolarmanTelemetryResponse {
  data: Array<{
    timestamp: string
    power: number
    voltage?: number
    current?: number
    temperature?: number
    [key: string]: any
  }>
  success: boolean
}

export class SolarmanAdapter extends BaseVendorAdapter {
  private vendorId?: number
  private dynamoClient?: DynamoDBDocumentClient

  /**
   * Set vendor ID and DynamoDB client for token storage
   */
  setTokenStorage(vendorId: number, dynamoClient: DynamoDBDocumentClient) {
    this.vendorId = vendorId
    this.dynamoClient = dynamoClient
  }

  /**
   * Get PRO API base URL from environment variables
   */
  private getProApiBaseUrl(): { url: string; isExplicit: boolean } {
    const proApiUrl = process.env.SOLARMAN_PRO_API_BASE_URL
    if (proApiUrl) {
      return { url: proApiUrl, isExplicit: true }
    }
    
    const regularApiUrl = this.getApiBaseUrl()
    if (regularApiUrl.includes('globalapi')) {
      const convertedUrl = regularApiUrl.replace('globalapi', 'globalpro')
      return { url: convertedUrl, isExplicit: false }
    }
    
    if (regularApiUrl.includes('globalpro')) {
      return { url: regularApiUrl, isExplicit: false }
    }
    
    return { url: 'https://globalpro.solarmanpv.com', isExplicit: false }
  }

  /**
   * Decode JWT token to check expiry
   */
  private decodeJWTExpiry(token: string): number | null {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) {
        return null
      }
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      if (payload.exp) {
        return payload.exp * 1000
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Get token from DynamoDB
   */
  private async getTokenFromDB(): Promise<string | null> {
    if (!this.vendorId || !this.dynamoClient) {
      return null
    }

    try {
      // Query config table for vendor
      const { GetItemCommand } = await import("@aws-sdk/lib-dynamodb")
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

      const now = Date.now()
      const bufferMs = 5 * 60 * 1000 // 5 minute buffer

      // Check token_expires_at field first
      if (response.Item.token_expires_at) {
        const expiresAt = new Date(response.Item.token_expires_at).getTime()
        if (expiresAt > now + bufferMs) {
          return response.Item.access_token
        } else {
          return null
        }
      }

      // Try JWT expiry
      const jwtExpiry = this.decodeJWTExpiry(response.Item.access_token)
      if (jwtExpiry && jwtExpiry > now + bufferMs) {
        return response.Item.access_token
      }

      return null
    } catch (error) {
      console.error('[Solarman] Error fetching token from DB:', error)
      return null
    }
  }

  /**
   * Store token in DynamoDB
   */
  private async storeTokenInDB(token: string, expiresIn: number, refreshToken?: string): Promise<void> {
    if (!this.vendorId || !this.dynamoClient) {
      return
    }

    try {
      const expiresAt = new Date(Date.now() + expiresIn * 1000)
      const jwtExpiry = this.decodeJWTExpiry(token)
      const finalExpiresAt = jwtExpiry ? new Date(jwtExpiry) : expiresAt

      const updateData: any = {
        access_token: token,
        token_expires_at: finalExpiresAt.toISOString(),
        token_metadata: {
          expires_in: expiresIn,
          stored_at: new Date().toISOString(),
        },
      }

      if (refreshToken) {
        updateData.refresh_token = refreshToken
      }

      const command = new UpdateItemCommand({
        TableName: "config",
        Key: {
          PK: "VENDOR",
          SK: this.vendorId.toString(),
        },
        UpdateExpression: "SET access_token = :token, token_expires_at = :expires, token_metadata = :metadata",
        ExpressionAttributeValues: {
          ":token": updateData.access_token,
          ":expires": updateData.token_expires_at,
          ":metadata": updateData.token_metadata,
        },
      })

      await this.dynamoClient.send(command)
    } catch (error) {
      console.error('[Solarman] Error storing token in DB:', error)
    }
  }

  async authenticate(): Promise<string> {
    const dbToken = await this.getTokenFromDB()
    if (dbToken) {
      return dbToken
    }

    const credentials = this.getCredentials() as {
      appId: string
      appSecret: string
      username: string
      password?: string
      passwordSha256?: string
      solarmanOrgId?: number
      orgId?: number
    }

    const requestBody: any = {
      appSecret: credentials.appSecret,
      username: credentials.username,
      password: credentials.password || credentials.passwordSha256,
    }

    if (!requestBody.password) {
      throw new Error('Solarman authentication failed: Password or passwordSha256 is required')
    }

    const orgId = credentials.solarmanOrgId || credentials.orgId
    if (orgId) {
      requestBody.orgId = orgId
    }

    let authBaseUrl = this.getApiBaseUrl()
    if (authBaseUrl.includes('globalpro')) {
      authBaseUrl = authBaseUrl.replace('globalpro', 'globalapi')
    }

    const urlObj = new URL(authBaseUrl)
    const baseDomain = `${urlObj.protocol}//${urlObj.host}`
    const url = `${baseDomain}/account/v1.0/token?appId=${credentials.appId}`

    const response = await pooledFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Solarman authentication failed: ${response.statusText} - ${errorText}`)
    }

    const data: SolarmanAuthResponse = await response.json()

    if (!data.access_token) {
      throw new Error('Solarman authentication failed: No access token in response')
    }

    await this.storeTokenInDB(data.access_token, data.expires_in || 3600)

    return data.access_token
  }

  async listPlants(): Promise<Plant[]> {
    const token = await this.authenticate()
    const { url: proApiUrl } = this.getProApiBaseUrl()
    
    return await this.listPlantsFromProApi(token, proApiUrl)
  }

  async listPlant(vendorPlantId: string): Promise<Plant | null> {
    const token = await this.authenticate()
    const { url: proApiUrl } = this.getProApiBaseUrl()
    const stationId = parseInt(vendorPlantId, 10)
    
    if (isNaN(stationId)) {
      throw new Error(`Invalid station ID: ${vendorPlantId}`)
    }

    const url = `${proApiUrl}/maintain-s/operating/station/v2/search`
    const requestBody = {
      station: {
        id: stationId,
        powerTypeList: ["PV"],
      },
    }

    const response = await pooledFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      return await this.listPlantFromBaseEndpoint(token, stationId)
    }

    const data = await response.json()
    
    if (!data.data || !Array.isArray(data.data) || data.data.length === 0) {
      return await this.listPlantFromBaseEndpoint(token, stationId)
    }

    const station = data.data[0]?.station
    if (!station) {
      return null
    }

    const capacityKw = station.installedCapacity || 0
    let location: any = undefined
    const locationAddress = station.locationAddress || null
    if (station.locationLat || station.locationLng || locationAddress) {
      location = {
        lat: station.locationLat,
        lng: station.locationLng,
        address: locationAddress,
      }
    }

    const currentPowerKw = station.generationPower ? station.generationPower / 1000 : null
    const dailyEnergyKwh = station.generationValue || null
    const monthlyEnergyMwh = station.generationMonth ? station.generationMonth / 1000 : null
    const yearlyEnergyMwh = station.generationYear ? station.generationYear / 1000 : null
    const totalEnergyMwh = station.generationUploadTotalOffset 
      ? station.generationUploadTotalOffset / 1000 
      : null
    const lastUpdateTime = station.lastUpdateTime 
      ? new Date(Math.floor(station.lastUpdateTime) * 1000).toISOString() 
      : null
    const createdDate = station.createdDate
      ? new Date(Math.floor(station.createdDate) * 1000).toISOString()
      : null
    const startOperatingTime = station.startOperatingTime
      ? new Date(Math.floor(station.startOperatingTime) * 1000).toISOString()
      : null

    return {
      id: station.id.toString(),
      name: station.name || `Station ${station.id}`,
      capacityKw,
      location,
      metadata: {
        stationId: station.id,
        currentPowerKw,
        dailyEnergyKwh,
        monthlyEnergyMwh,
        yearlyEnergyMwh,
        totalEnergyMwh,
        networkStatus: station.networkStatus ? String(station.networkStatus).trim() : null,
        lastUpdateTime,
        createdDate,
        startOperatingTime,
        locationAddress,
      },
    }
  }

  private async listPlantFromBaseEndpoint(token: string, stationId: number): Promise<Plant | null> {
    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/station/v1.0/base?language=en`

    const response = await pooledFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ stationId }),
    })

    if (!response.ok) {
      return null
    }

    const station = await response.json()
    
    if (!station || !station.stationId) {
      return null
    }

    const capacityKw = station.installedCapacity ? station.installedCapacity / 1000 : 0
    let location: any = undefined
    if (station.location) {
      location = {
        lat: parseFloat(station.location.lat) || null,
        lng: parseFloat(station.location.lng) || null,
        address: station.location.address || null,
      }
    }

    const startOperatingTime = station.startOperatingTime
      ? new Date(station.startOperatingTime * 1000).toISOString()
      : null

    return {
      id: station.stationId.toString(),
      name: station.name || `Station ${station.stationId}`,
      capacityKw,
      location,
      metadata: {
        stationId: station.stationId,
        startOperatingTime,
        ownerName: station.ownerName || null,
        ownerCompany: station.ownerCompany || null,
      },
    }
  }

  private async listPlantsFromProApi(token: string, proApiBaseUrl: string): Promise<Plant[]> {
    const url = `${proApiBaseUrl}/maintain-s/operating/station/v2/search`
    
    const requestBody = {
      station: {
        powerTypeList: ["PV"]
      }
    }

    const response = await pooledFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch stations from PRO API: ${response.statusText} - ${errorText}`)
    }

    const data = await response.json()

    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid response format from Solarman PRO API - expected data array")
    }

    const allStations = data.data.map((item: any) => item.station).filter((s: any) => s !== undefined)

    return allStations.map((station: any) => {
      const stationId = station.id
      const stationName = station.name || `Station ${stationId}`
      const capacityKw = station.installedCapacity || 0
      
      let location: any = undefined
      const locationAddress = station.locationAddress || null
      if (station.locationLat || station.locationLng || locationAddress) {
        location = {
          lat: station.locationLat,
          lng: station.locationLng,
          address: locationAddress,
        }
      }

      const currentPowerKw = station.generationPower ? station.generationPower / 1000 : null
      const dailyEnergyKwh = station.generationValue || null
      const monthlyEnergyMwh = station.generationMonth ? station.generationMonth / 1000 : null
      const yearlyEnergyMwh = station.generationYear ? station.generationYear / 1000 : null
      const totalEnergyMwh = station.generationUploadTotalOffset 
        ? station.generationUploadTotalOffset / 1000 
        : null
      const lastUpdateTime = station.lastUpdateTime 
        ? new Date(Math.floor(station.lastUpdateTime) * 1000).toISOString() 
        : null
      const createdDate = station.createdDate
        ? new Date(Math.floor(station.createdDate) * 1000).toISOString()
        : null
      const startOperatingTime = station.startOperatingTime
        ? new Date(Math.floor(station.startOperatingTime) * 1000).toISOString()
        : null

      return {
        id: stationId.toString(),
        name: stationName,
        capacityKw: capacityKw,
        location: location,
        metadata: {
          stationId: stationId,
          currentPowerKw,
          dailyEnergyKwh,
          monthlyEnergyMwh,
          yearlyEnergyMwh,
          totalEnergyMwh,
          fullPowerHoursDay: station.fullPowerHoursDay || null,
          generationCapacity: station.generationCapacity || null,
          usePower: station.usePower || null,
          useMonth: station.useMonth || null,
          useYear: station.useYear || null,
          useTotal: station.useTotal || null,
          powerType: station.powerType || null,
          system: station.system || null,
          lastUpdateTime,
          networkStatus: station.networkStatus ? String(station.networkStatus).trim() : null,
          type: station.type,
          locationAddress,
          gridInterconnectionType: station.gridInterconnectionType,
          regionTimezone: station.regionTimezone,
          startOperatingTime,
          createdDate,
          regionLevel1: station.regionLevel1,
          regionLevel2: station.regionLevel2,
          regionLevel3: station.regionLevel3,
          regionLevel4: station.regionLevel4,
          regionLevel5: station.regionLevel5,
          regionNationId: station.regionNationId,
          installationAzimuthAngle: station.installationAzimuthAngle,
          installationTiltAngle: station.installationTiltAngle,
          businessWarningStatus: station.businessWarningStatus,
          consumerWarningStatus: station.consumerWarningStatus,
          operating: station.operating,
        },
      }
    })
  }

  async getTelemetry(
    plantId: string,
    startTime: Date,
    endTime: Date
  ): Promise<TelemetryData[]> {
    throw new Error("getTelemetry requires deviceId. Use getDeviceTelemetry(deviceId, ...) instead.")
  }

  async getRealtime(plantId: string): Promise<RealtimeData> {
    throw new Error("getRealtime requires deviceId. Use getDeviceRealtime(deviceId) instead.")
  }

  async getAlerts(plantId: string): Promise<Alert[]> {
    throw new Error("getAlerts requires deviceId. Use getDeviceAlerts(deviceId, ...) instead.")
  }

  protected normalizeTelemetry(rawData: any): TelemetryData {
    return {
      plantId: rawData.plantId,
      timestamp: new Date(rawData.timestamp * 1000),
      generationPowerKw: rawData.power || 0,
      voltage: rawData.voltage,
      current: rawData.current,
      temperature: rawData.temperature,
      metadata: {
        ...rawData,
      },
    }
  }

  protected normalizeAlert(rawData: any): Alert {
    const severityMap: Record<number, Alert["severity"]> = {
      0: "LOW",
      1: "MEDIUM",
      2: "HIGH",
    }

    let severity = severityMap[rawData.level] || "MEDIUM"
    if (rawData.influence === 2 || rawData.influence === 3) {
      severity = "CRITICAL"
    } else if (rawData.influence === 1 && severity === "LOW") {
      severity = "MEDIUM"
    }

    return {
      vendorAlertId: rawData.alertId?.toString(),
      title: rawData.alertName || "Alert",
      description: rawData.description || rawData.addr || "",
      severity,
    }
  }
}

