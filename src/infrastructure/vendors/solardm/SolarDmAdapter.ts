/**
 * SolarDM Vendor Adapter
 * 
 * Implements SolarDM API integration.
 * Based on WOMS SolarDmAdapter implementation.
 */

import { BaseVendorAdapter } from "../base/BaseVendorAdapter"
import type { Plant, TelemetryData, Alert, RealtimeData } from "../types"
import { pooledFetch } from "../httpClient"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/lib-dynamodb"

interface SolarDmAuthResponse {
  code: number
  message: string
  data: {
    token: string
    refreshToken: string
    tokenHead: string
    expiresIn: number
  }
}

interface SolarDmPlantResponse {
  code: number
  message: string
  data: {
    total: number
    list: Array<{
      id: string
      plantName: string
      address: string
      timeZone: number
      type: number
      systemType: number
      capacity: string
      longitude: number
      latitude: number
      monetaryUnit: number
      ownerName: string
      ownerPhone: string
      isDeleted: number
      createBy: string
      createTime: string
      updateBy: string
      updateTime: string
      communicateStatus: number
      alarmStatus: number
      isSelf: boolean
      createByType: number
      [key: string]: any
    }>
  }
}

export class SolarDmAdapter extends BaseVendorAdapter {
  private vendorId?: number
  private dynamoClient?: DynamoDBDocumentClient

  setTokenStorage(vendorId: number, dynamoClient: DynamoDBDocumentClient) {
    this.vendorId = vendorId
    this.dynamoClient = dynamoClient
  }

  protected getApiBaseUrl(): string {
    if (this.config.apiBaseUrl) {
      return this.config.apiBaseUrl
    }
    return process.env.SOLARDM_API_BASE_URL || "http://global.solar-dm.com:8010"
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
      console.error("[SolarDM] Error getting token from DB:", error)
      return null
    }
  }

  private async storeTokenInDB(
    token: string,
    expiresIn: number,
    refreshToken?: string
  ): Promise<void> {
    if (!this.vendorId || !this.dynamoClient) {
      return
    }

    try {
      const expiresAt = new Date(Date.now() + expiresIn * 1000)

      const updateData: any = {
        access_token: token,
        token_expires_at: expiresAt.toISOString(),
        token_metadata: {
          token_type: "Bearer",
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
        UpdateExpression: "SET access_token = :token, token_expires_at = :expires, token_metadata = :metadata" + (refreshToken ? ", refresh_token = :refresh" : ""),
        ExpressionAttributeValues: {
          ":token": updateData.access_token,
          ":expires": updateData.token_expires_at,
          ":metadata": updateData.token_metadata,
          ...(refreshToken ? { ":refresh": refreshToken } : {}),
        },
      })

      await this.dynamoClient.send(command)
    } catch (error) {
      console.error("[SolarDM] Error storing token:", error)
    }
  }

  async authenticate(): Promise<string> {
    const cachedToken = await this.getTokenFromDB()
    if (cachedToken) {
      return cachedToken
    }

    const credentials = this.getCredentials()
    const email = credentials.email as string
    const passwordRSA = credentials.passwordRSA as string

    if (!email || !passwordRSA) {
      throw new Error("SolarDM credentials missing: email and passwordRSA are required")
    }

    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/ums/business/email_login`

    const requestBody = {
      email,
      password: passwordRSA,
      loginType: "email",
      regionSign: "3",
    }

    const response = await pooledFetch(url, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=UTF-8",
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`SolarDM authentication failed: ${response.statusText} - ${errorText}`)
    }

    const data: SolarDmAuthResponse = await response.json()

    if (data.code !== 0 || !data.data?.token) {
      throw new Error(`SolarDM authentication failed: ${data.message || "Unknown error"}`)
    }

    await this.storeTokenInDB(
      data.data.token,
      data.data.expiresIn,
      data.data.refreshToken
    )

    return data.data.token
  }

  private parseSolarDmValue(valueStr: string | null | undefined): number | null {
    if (!valueStr || typeof valueStr !== 'string') {
      return null
    }

    const parts = valueStr.split('_')
    if (parts.length === 0) {
      return null
    }

    const numericPart = parts[0]
    const parsed = parseFloat(numericPart)
    
    return isNaN(parsed) ? null : parsed
  }

  async listPlant(vendorPlantId: string): Promise<Plant | null> {
    const baseUrl = this.getApiBaseUrl()

    let plantName: string | null = null
    let networkStatus: string | null = null
    let lastUpdateTime: string | null = null

    try {
      const plantInfoUrl = `${baseUrl}/dms/plant/${vendorPlantId}`
      const plantInfoResponse = await pooledFetch(plantInfoUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await this.authenticate()}`,
        },
      })

      if (plantInfoResponse.ok) {
        const plantInfoData = await plantInfoResponse.json()

        if (plantInfoData.code === 0 && plantInfoData.data) {
          const plantData = plantInfoData.data
          plantName = plantData.plantName || null

          if (plantData.communicateStatus === 1) {
            networkStatus = "NORMAL"
          } else if (plantData.communicateStatus === 2) {
            networkStatus = "ALL_OFFLINE"
          } else if (plantData.communicateStatus === 3) {
            networkStatus = "PARTIAL_OFFLINE"
          }

          if (plantData.lastUpdateTime) {
            try {
              const dateStr = plantData.lastUpdateTime.replace(" ", "T")
              const date = new Date(dateStr)
              if (!isNaN(date.getTime())) {
                lastUpdateTime = date.toISOString()
              }
            } catch (parseError) {
              console.warn(`[SolarDM] Failed to parse lastUpdateTime: ${plantData.lastUpdateTime}`, parseError)
            }
          }
        } else if (plantInfoData.code !== 0) {
          return null
        }
      }
    } catch (plantInfoError: any) {
      console.warn(`[SolarDM] Error fetching plant info for plant ${vendorPlantId}:`, plantInfoError.message)
    }

    if (!plantName) {
      console.warn(`[SolarDM] Could not fetch plant info for ${vendorPlantId}, plant may not exist`)
    }

    try {
      const meteringUrl = `${baseUrl}/dms/data_panel/metering/sub_v2/${vendorPlantId}`
      const response = await pooledFetch(meteringUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await this.authenticate()}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Failed to fetch live telemetry: ${response.statusText} - ${errorText}`)
      }

      const data = await response.json()

      if (data.code !== 0 || !data.data?.energy) {
        throw new Error(`SolarDM API error: ${data.message || "Unknown error"}`)
      }

      const energy = data.data.energy

      const dailyEnergyKwh = this.parseSolarDmValue(energy.currDay)
      const monthlyEnergyKwh = this.parseSolarDmValue(energy.currMonth)
      const yearlyEnergyKwh = this.parseSolarDmValue(energy.currYear)
      const totalEnergyKwh = this.parseSolarDmValue(energy.total)
      const currentPowerKw = this.parseSolarDmValue(energy.power)
      const capacityKw = this.parseSolarDmValue(energy.capacity) || 0

      const monthlyEnergyMwh = monthlyEnergyKwh !== null ? monthlyEnergyKwh / 1000 : null
      const yearlyEnergyMwh = yearlyEnergyKwh !== null ? yearlyEnergyKwh / 1000 : null
      const totalEnergyMwh = totalEnergyKwh !== null ? totalEnergyKwh / 1000 : null

      if (!lastUpdateTime) {
        lastUpdateTime = new Date().toISOString()
      }

      return {
        id: vendorPlantId,
        name: plantName || `Plant ${vendorPlantId}`,
        capacityKw,
        location: undefined,
        metadata: {
          currentPowerKw,
          dailyEnergyKwh,
          monthlyEnergyMwh,
          yearlyEnergyMwh,
          totalEnergyMwh,
          networkStatus,
          lastUpdateTime,
        },
      }
    } catch (error: any) {
      console.error(`[SolarDM] Error fetching live telemetry for plant ${vendorPlantId}:`, error.message)
      if (plantName) {
        return {
          id: vendorPlantId,
          name: plantName,
          capacityKw: 0,
          location: undefined,
          metadata: {
            networkStatus,
            lastUpdateTime,
          },
        }
      }
      return null
    }
  }

  async listPlants(): Promise<Plant[]> {
    const token = await this.authenticate()
    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/dms/plant/list_all`

    const response = await pooledFetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Failed to fetch plants from SolarDM: ${response.statusText} - ${errorText}`)
    }

    const data: SolarDmPlantResponse = await response.json()

    if (data.code !== 0 || !data.data?.list) {
      throw new Error(`SolarDM API error: ${data.message || "Unknown error"}`)
    }

    const plants = data.data.list || []

    return plants.map((plant) => {
      const capacityKw = parseFloat(plant.capacity) || 0

      let location: any = undefined
      if (plant.latitude || plant.longitude || plant.address) {
        location = {
          lat: plant.latitude || null,
          lng: plant.longitude || null,
          address: plant.address || null,
        }
      }

      let networkStatus: string | null = null
      if (plant.communicateStatus === 1) {
        networkStatus = "NORMAL"
      } else if (plant.communicateStatus === 2) {
        networkStatus = "ALL_OFFLINE"
      } else if (plant.communicateStatus === 3) {
        networkStatus = "PARTIAL_OFFLINE"
      }

      let vendorCreatedDate: string | null = null
      let startOperatingTime: string | null = null
      if (plant.createTime) {
        try {
          const date = new Date(plant.createTime.replace(" ", "T"))
          if (!isNaN(date.getTime())) {
            const isoString = date.toISOString()
            vendorCreatedDate = isoString
            startOperatingTime = isoString
          }
        } catch (error) {
          console.warn(`[SolarDM] Failed to parse createTime: ${plant.createTime}`, error)
        }
      }

      return {
        id: plant.id,
        name: plant.plantName || `Plant ${plant.id}`,
        capacityKw,
        location,
        metadata: {
          networkStatus,
          createdDate: vendorCreatedDate,
          startOperatingTime,
          locationAddress: plant.address || null,
          raw: {
            communicateStatus: plant.communicateStatus,
            alarmStatus: plant.alarmStatus,
            timeZone: plant.timeZone,
            type: plant.type,
            systemType: plant.systemType,
            createTime: plant.createTime,
            updateTime: plant.updateTime,
          },
        },
      }
    })
  }

  async getTelemetry(
    plantId: string,
    startTime: Date,
    endTime: Date
  ): Promise<TelemetryData[]> {
    console.warn("[SolarDM] getTelemetry() called - not yet implemented. Use specific period methods if available.")
    return []
  }

  async getRealtime(plantId: string): Promise<RealtimeData> {
    return {
      plantId,
      timestamp: new Date(),
      data: {},
    }
  }

  async getAlerts(plantId: string): Promise<Alert[]> {
    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/dms/inverter_fault/page_list/all`
    
    const params = new URLSearchParams({
      current: "1",
      size: "100",
      faultInfo: "There is no mains voltage"
    })
    
    const response = await pooledFetch(
      `${url}?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${await this.authenticate()}`,
        },
      }
    )
    
    if (!response.ok) {
      const text = await response.text()
      throw new Error(
        `SolarDM alerts request failed: ${response.status} ${response.statusText} - ${text}`
      )
    }
    
    const data = await response.json()
    
    if (data.code !== 0) {
      throw new Error(`SolarDM API error: ${data.message || "Unknown error"}`)
    }
    
    const records = data.data?.records || []
    const plantAlerts = records.filter((record: any) => record.plantId === plantId)
    
    return plantAlerts.map((record: any) => this.normalizeAlert(record))
  }

  protected normalizeTelemetry(rawData: any): TelemetryData {
    return {
      plantId: rawData.plantId || "",
      timestamp: new Date(rawData.timestamp || Date.now()),
      generationPowerKw: rawData.generationPowerKw || 0,
    }
  }

  protected normalizeAlert(rawData: any): Alert {
    const severityMap: Record<number, "HIGH" | "MEDIUM" | "LOW" | "CRITICAL"> = {
      1: "HIGH",
      2: "MEDIUM",
      3: "LOW",
      4: "CRITICAL",
    }
    
    const severity = severityMap[rawData.faultLevel] || "MEDIUM"
    
    return {
      vendorAlertId: rawData.id?.toString() || "",
      title: rawData.faultInfo || "Alert",
      description: "No Mains Voltage",
      severity,
    }
  }
}

