/**
 * Base Vendor Adapter
 * 
 * Abstract base class for all vendor adapters.
 * Each vendor implementation must extend this class and implement all abstract methods.
 * 
 * Based on WOMS BaseVendorAdapter implementation.
 */

import type {
  VendorConfig,
  Plant,
  TelemetryData,
  Alert,
  RealtimeData,
} from "../types"

export abstract class BaseVendorAdapter {
  protected config: VendorConfig

  constructor(config: VendorConfig) {
    this.config = config
  }

  /**
   * Authenticate with vendor API and return access token
   * Should implement token caching internally (using DynamoDB for token storage)
   */
  abstract authenticate(): Promise<string>

  /**
   * List all plants/stations available from this vendor
   */
  abstract listPlants(): Promise<Plant[]>

  /**
   * Get a single plant by vendor plant ID
   * Used for fetching live telemetry when not available in listPlants()
   * Default implementation throws - vendors should override if they support this
   */
  async listPlant(vendorPlantId: string): Promise<Plant | null> {
    // Default implementation: not supported
    // Vendors that support per-plant fetching should override this method
    throw new Error(`listPlant() not implemented for vendor type: ${this.config.vendorType}`)
  }

  /**
   * Get telemetry data for a specific plant
   * @param plantId - Vendor-specific plant identifier
   * @param startTime - Start time for telemetry range
   * @param endTime - End time for telemetry range
   */
  abstract getTelemetry(
    plantId: string,
    startTime: Date,
    endTime: Date
  ): Promise<TelemetryData[]>

  /**
   * Get realtime data for a specific plant
   */
  abstract getRealtime(plantId: string): Promise<RealtimeData>

  /**
   * Get active alerts for a specific plant
   */
  abstract getAlerts(plantId: string): Promise<Alert[]>

  /**
   * Normalize vendor-specific telemetry data to standard format
   */
  protected abstract normalizeTelemetry(rawData: any): TelemetryData

  /**
   * Normalize vendor-specific alert data to standard format
   */
  protected abstract normalizeAlert(rawData: any): Alert

  /**
   * Get API base URL from config or environment variables
   */
  protected getApiBaseUrl(): string {
    // For backward compatibility, check config first, then fall back to vendor-specific env vars
    if (this.config.apiBaseUrl) {
      return this.config.apiBaseUrl
    }
    
    // Get vendor-specific base URL from environment variables
    const vendorType = this.config.vendorType.toUpperCase()
    const envVarName = `${vendorType}_API_BASE_URL`
    const baseUrl = process.env[envVarName]
    
    if (!baseUrl) {
      throw new Error(
        `API base URL not configured. Please set ${envVarName} environment variable or provide apiBaseUrl in config.`
      )
    }
    
    return baseUrl
  }

  protected getCredentials(): Record<string, any> {
    return this.config.credentials
  }

  /**
   * Set token storage (for DynamoDB-backed token caching)
   * Vendors can override this if they support token storage
   */
  setTokenStorage?(vendorId: number, dynamoClient: any): void

  /**
   * Fetch with authentication
   * Vendors should implement this to add auth headers
   */
  protected async fetchWithAuth(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const token = await this.authenticate()
    const url = `${this.getApiBaseUrl()}${endpoint}`

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    })
  }
}

