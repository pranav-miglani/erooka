/**
 * Alert Sync Lambda Handler
 * 
 * EventBridge trigger: Runs every 30 minutes
 * Syncs alerts from all active vendors.
 */

import type { EventBridgeEvent } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBAlertRepository } from "../../../infrastructure/dynamodb/repositories/AlertRepository"
import { DynamoDBVendorRepository } from "../../../infrastructure/dynamodb/repositories/VendorRepository"
import { DynamoDBPlantRepository } from "../../../infrastructure/dynamodb/repositories/PlantRepository"
import { AlertSyncService } from "../../../application/sync/AlertSyncService"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const alertRepository = new DynamoDBAlertRepository(dynamoClient)
const vendorRepository = new DynamoDBVendorRepository(dynamoClient)
const plantRepository = new DynamoDBPlantRepository(dynamoClient)

const alertSyncService = new AlertSyncService(
  alertRepository,
  vendorRepository,
  plantRepository,
  dynamoClient
)

export async function handler(
  event: EventBridgeEvent<"Scheduled Event", any>
): Promise<void> {
  console.log("[AlertSync] Event received:", JSON.stringify(event, null, 2))

  try {
    const summary = await alertSyncService.syncAllVendors()

    console.log("[AlertSync] Sync completed:", JSON.stringify(summary, null, 2))

    if (summary.failed > 0) {
      throw new Error(
        `${summary.failed} vendors failed to sync. Check logs for details.`
      )
    }
  } catch (error: any) {
    console.error("[AlertSync] Error:", error)
    throw error
  }
}

