/**
 * Telemetry Sync Lambda Handler
 * 
 * EventBridge trigger: Runs every 15 minutes (5 AM - 8 PM working window)
 * Syncs live telemetry data (current power, daily energy, etc.) for all plants.
 */

import type { EventBridgeEvent } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { DynamoDBVendorRepository } from "../../../infrastructure/dynamodb/repositories/VendorRepository"
import { TelemetrySyncService } from "../../../application/sync/TelemetrySyncService"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const plantRepository = new DynamoDBPlantRepository(dynamoClient)
const vendorRepository = new DynamoDBVendorRepository(dynamoClient)

const telemetrySyncService = new TelemetrySyncService(
  plantRepository,
  vendorRepository,
  dynamoClient
)

export async function handler(
  event: EventBridgeEvent<"Scheduled Event", any>
): Promise<void> {
  console.log("[TelemetrySync] Event received:", JSON.stringify(event, null, 2))

  try {
    // Check if we're in working window (5 AM - 8 PM IST)
    const now = new Date()
    const istTime = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now)

    const [hour, minute] = istTime.split(":").map(Number)
    const currentMinutes = hour * 60 + minute
    const startMinutes = 5 * 60 // 5 AM
    const endMinutes = 20 * 60 // 8 PM

    if (currentMinutes < startMinutes || currentMinutes >= endMinutes) {
      console.log(
        `[TelemetrySync] Outside working window (5 AM - 8 PM IST). Current time: ${istTime}. Skipping sync.`
      )
      return
    }

    const summary = await telemetrySyncService.syncAllVendors()

    console.log("[TelemetrySync] Sync completed:", JSON.stringify(summary, null, 2))

    if (summary.failed > 0) {
      throw new Error(
        `${summary.failed} vendors failed to sync. Check logs for details.`
      )
    }
  } catch (error: any) {
    console.error("[TelemetrySync] Error:", error)
    throw error
  }
}

