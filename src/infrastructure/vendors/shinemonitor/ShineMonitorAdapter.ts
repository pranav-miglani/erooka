/**
 * ShineMonitor Vendor Adapter
 * 
 * Implements ShineMonitor API integration with sign/salt authentication.
 * Based on WOMS ShineMonitorAdapter implementation.
 */

import { BaseVendorAdapter } from "../base/BaseVendorAdapter"
import type { Plant, TelemetryData, Alert, RealtimeData } from "../types"
import { pooledFetch } from "../httpClient"
import { createHash } from "crypto"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { UpdateItemCommand, GetItemCommand } from "@aws-sdk/lib-dynamodb"

interface ShineMonitorAuthResponse {
  err: number
  desc: string
  dat: {
    secret: string
    expire: number
    token: string
    role: number
    usr: string
    uid: number
  }
}

interface ShineMonitorPlantResponse {
  err: number
  desc: string
  dat: {
    total: number
    page: number
    pagesize: number
    plant: Array<{
      pid: number
      uid: number
      usr: string
      name: string
      type: number
      status: number
      address: {
        lon: string
        lat: string
        address?: string
        timezone: number
      }
      nominalPower: string
      install: string
      gts: string
      outputPower: string
      energy: string
      energyMonth: string
      energyYear: string
      energyTotal: string
      energyDatDate: string
    }>
  }
}

export class ShineMonitorAdapter extends BaseVendorAdapter {
  private vendorId?: number
  private dynamoClient?: DynamoDBDocumentClient
  private secret?: string

  setTokenStorage(vendorId: number, dynamoClient: DynamoDBDocumentClient) {
    this.vendorId = vendorId
    this.dynamoClient = dynamoClient
  }

  protected getApiBaseUrl(): string {
    if (this.config.apiBaseUrl) {
      return this.config.apiBaseUrl
    }
    return process.env.SHINEMONITOR_API_BASE_URL || "https://web.shinemonitor.com/public"
  }

  private sha1(input: string): string {
    return createHash("sha1").update(input).digest("hex")
  }

  private generateSalt(): string {
    return new Date().getTime().toString()
  }

  private generateSign(
    salt: string,
    passHash: string,
    userName: string,
    companyKey: string
  ): string {
    const actionString = `&action=auth&usr=${userName}&company-key=${companyKey}`
    const signInput = salt + passHash + actionString
    return this.sha1(signInput)
  }

  private generateSignForApi(
    salt: string,
    secret: string,
    token: string,
    queryParams: URLSearchParams
  ): string {
    const parts: string[] = []
    queryParams.forEach((value, key) => {
      if (key !== "sign" && key !== "salt" && key !== "token") {
        parts.push(`${key}=${value}`)
      }
    })

    let finalQueryString = parts.join("&")
    if (finalQueryString && !finalQueryString.startsWith("&")) {
      finalQueryString = "&" + finalQueryString
    }

    const signInput = salt + secret + token + finalQueryString
    return this.sha1(signInput)
  }

  private async getTokenFromDB(): Promise<{ token: string; secret: string } | null> {
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

      const secret = response.Item.token_metadata?.secret || null
      const token = response.Item.access_token || null

      if (token && secret) {
        this.secret = secret
        return { token, secret }
      }

      return null
    } catch (error) {
      console.error("[ShineMonitor] Error getting token from DB:", error)
      return null
    }
  }

  private async storeTokenInDB(
    token: string,
    secret: string,
    expiresIn: number
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
            secret: secret,
            expires_in: expiresIn,
            stored_at: new Date().toISOString(),
          },
        },
      })

      await this.dynamoClient.send(command)
      this.secret = secret
    } catch (error) {
      console.error("[ShineMonitor] Error storing token:", error)
    }
  }

  async authenticate(): Promise<string> {
    const cached = await this.getTokenFromDB()
    if (cached) {
      return cached.token
    }

    const credentials = this.getCredentials()
    const userName = credentials.user_name as string
    const passHash = credentials.pass_hash as string
    const companyKey = credentials.company_key as string

    if (!userName || !passHash || !companyKey) {
      throw new Error(
        "ShineMonitor credentials missing: user_name, pass_hash, and company_key are required"
      )
    }

    const salt = this.generateSalt()
    const sign = this.generateSign(salt, passHash, userName, companyKey)

    const baseUrl = this.getApiBaseUrl()
    const url = `${baseUrl}/?sign=${sign}&salt=${salt}&action=auth&usr=${userName}&company-key=${companyKey}`

    const response = await pooledFetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Origin: "https://kstar.shinemonitor.com",
        Referer: "https://kstar.shinemonitor.com/",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `ShineMonitor authentication failed: ${response.statusText} - ${errorText}`
      )
    }

    const data: ShineMonitorAuthResponse = await response.json()

    if (data.err !== 0 || !data.dat?.token) {
      throw new Error(
        `ShineMonitor authentication failed: ${data.desc || "Unknown error"}`
      )
    }

    await this.storeTokenInDB(data.dat.token, data.dat.secret, data.dat.expire)

    return data.dat.token
  }

  async listPlant(vendorPlantId: string): Promise<Plant | null> {
    const allPlants = await this.listPlants()
    const plant = allPlants.find((p) => p.id === vendorPlantId)
    return plant || null
  }

  async listPlants(): Promise<Plant[]> {
    const cached = await this.getTokenFromDB()
    if (!cached) {
      await this.authenticate()
      const refreshed = await this.getTokenFromDB()
      if (!refreshed) {
        throw new Error("Failed to get ShineMonitor token")
      }
      this.secret = refreshed.secret
    } else {
      this.secret = cached.secret
    }

    const token = cached?.token || (await this.authenticate())
    const secret = this.secret

    if (!secret) {
      throw new Error("ShineMonitor secret not available")
    }

    const baseUrl = this.getApiBaseUrl()
    const pageSize = 100
    let currentPage = 0
    let totalPages = 1
    const allPlants: Plant[] = []

    while (currentPage <= totalPages) {
      const salt = this.generateSalt()

      const queryParamsForSign = new URLSearchParams()
      queryParamsForSign.append("action", "webQueryPlants")
      queryParamsForSign.append("orderBy", "ascPlantId")
      queryParamsForSign.append("page", currentPage.toString())
      queryParamsForSign.append("pagesize", pageSize.toString())

      const sign = this.generateSignForApi(salt, secret, token, queryParamsForSign)

      const finalQueryParams = new URLSearchParams()
      finalQueryParams.set("sign", sign)
      finalQueryParams.set("salt", salt)
      finalQueryParams.set("token", token)
      finalQueryParams.set("action", queryParamsForSign.get("action") || "")
      finalQueryParams.set("orderBy", queryParamsForSign.get("orderBy") || "")
      finalQueryParams.set("page", queryParamsForSign.get("page") || "")
      finalQueryParams.set("pagesize", queryParamsForSign.get("pagesize") || "")

      const url = `${baseUrl}/?${finalQueryParams.toString()}`

      const response = await pooledFetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
          Connection: "keep-alive",
          Origin: "https://kstar.shinemonitor.com",
          Referer: "https://kstar.shinemonitor.com/",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(
          `Failed to fetch plants from ShineMonitor: ${response.statusText} - ${errorText}`
        )
      }

      const data: ShineMonitorPlantResponse = await response.json()

      if (data.err !== 0) {
        throw new Error(`ShineMonitor API error: ${data.desc || "Unknown error"}`)
      }

      const plants = data.dat?.plant || []
      const total = data.dat?.total || 0

      if (currentPage === 0) {
        totalPages = Math.ceil(total / pageSize) - 1
      }

      const mappedPlants = plants.map((plant) => {
        const capacityKw = parseFloat(plant.nominalPower) || 0

        let location: any = undefined
        if (plant.address) {
          location = {
            lat: plant.address.lat ? parseFloat(plant.address.lat) : null,
            lng: plant.address.lon ? parseFloat(plant.address.lon) : null,
            address: plant.address.address || plant.usr || null,
          }
        }

        let networkStatus: string | null = null
        if (plant.status === 0) {
          networkStatus = "NORMAL"
        } else if (plant.status === 1) {
          networkStatus = "ALL_OFFLINE"
        } else {
          networkStatus = "PARTIAL_OFFLINE"
        }

        let vendorCreatedDate: string | null = null
        if (plant.install) {
          try {
            const date = new Date(plant.install.replace(" ", "T"))
            if (!isNaN(date.getTime())) {
              vendorCreatedDate = date.toISOString()
            }
          } catch (error) {
            console.warn(`[ShineMonitor] Failed to parse install date: ${plant.install}`, error)
          }
        }

        let startOperatingTime: string | null = null
        if (plant.gts) {
          try {
            const date = new Date(plant.gts.replace(" ", "T"))
            if (!isNaN(date.getTime())) {
              startOperatingTime = date.toISOString()
            }
          } catch (error) {
            console.warn(`[ShineMonitor] Failed to parse gts: ${plant.gts}`, error)
          }
        }

        const currentPowerKw = parseFloat(plant.outputPower) || 0
        const dailyEnergyKwh = parseFloat(plant.energy) || 0
        const monthlyEnergyMwh = (parseFloat(plant.energyMonth) || 0) / 1000
        const yearlyEnergyMwh = (parseFloat(plant.energyYear) || 0) / 1000
        const totalEnergyMwh = (parseFloat(plant.energyTotal) || 0) / 1000

        let lastUpdateTime: string | null = null
        if (plant.energyDatDate) {
          try {
            const date = new Date(plant.energyDatDate.replace(" ", "T"))
            if (!isNaN(date.getTime())) {
              lastUpdateTime = date.toISOString()
            }
          } catch (error) {
            console.warn(`[ShineMonitor] Failed to parse energyDatDate: ${plant.energyDatDate}`, error)
          }
        }

        return {
          id: plant.pid.toString(),
          name: plant.name || `Plant ${plant.pid}`,
          capacityKw,
          location,
          metadata: {
            currentPowerKw,
            dailyEnergyKwh,
            monthlyEnergyMwh,
            yearlyEnergyMwh,
            totalEnergyMwh,
            lastUpdateTime,
            networkStatus,
            createdDate: vendorCreatedDate,
            startOperatingTime,
            locationAddress: plant.address?.address || plant.usr || null,
            raw: {
              pid: plant.pid,
              uid: plant.uid,
              usr: plant.usr,
              type: plant.type,
              status: plant.status,
              address: plant.address,
              nominalPower: plant.nominalPower,
              install: plant.install,
              gts: plant.gts,
              outputPower: plant.outputPower,
              energy: plant.energy,
              energyMonth: plant.energyMonth,
              energyYear: plant.energyYear,
              energyTotal: plant.energyTotal,
              energyDatDate: plant.energyDatDate,
            },
          },
        }
      })

      allPlants.push(...mappedPlants)

      if (currentPage >= totalPages || plants.length === 0) {
        break
      }

      currentPage++
    }

    return allPlants
  }

  async getTelemetry(
    plantId: string,
    startTime: Date,
    endTime: Date
  ): Promise<TelemetryData[]> {
    throw new Error("ShineMonitor telemetry not yet implemented")
  }

  async getRealtime(plantId: string): Promise<RealtimeData> {
    throw new Error("ShineMonitor realtime data not yet implemented")
  }

  async getAlerts(plantId: string): Promise<Alert[]> {
    throw new Error("ShineMonitor alerts not yet implemented")
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
