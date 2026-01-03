/**
 * WMS Insolation Sync Lambda Handler
 * 
 * EventBridge trigger: Runs daily
 * Syncs insolation readings from all active WMS vendors.
 */

import type { EventBridgeEvent } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBWMSVendorRepository } from "../../../infrastructure/dynamodb/repositories/WMSVendorRepository"
import { DynamoDBWMSSiteRepository } from "../../../infrastructure/dynamodb/repositories/WMSSiteRepository"
import { DynamoDBWMSDeviceRepository } from "../../../infrastructure/dynamodb/repositories/WMSDeviceRepository"
import { DynamoDBInsolationReadingRepository } from "../../../infrastructure/dynamodb/repositories/InsolationReadingRepository"
import { WMSSyncService } from "../../../application/sync/WMSSyncService"

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

const wmsVendorRepository = new DynamoDBWMSVendorRepository(dynamoClient)
const wmsSiteRepository = new DynamoDBWMSSiteRepository(dynamoClient)
const wmsDeviceRepository = new DynamoDBWMSDeviceRepository(dynamoClient)
const insolationReadingRepository = new DynamoDBInsolationReadingRepository(dynamoClient)

const wmsSyncService = new WMSSyncService(
  wmsVendorRepository,
  wmsSiteRepository,
  wmsDeviceRepository,
  insolationReadingRepository
)

export async function handler(
  event: EventBridgeEvent<"Scheduled Event", any>
): Promise<void> {
  console.log("[WMSInsolationSync] Event received:", JSON.stringify(event, null, 2))

  try {
    const results = await wmsSyncService.syncAllVendorInsolation()

    console.log("[WMSInsolationSync] Sync completed:", JSON.stringify(results, null, 2))

    const failed = results.filter((r) => !r.success).length
    if (failed > 0) {
      throw new Error(
        `${failed} vendors failed to sync. Check logs for details.`
      )
    }
  } catch (error: any) {
    console.error("[WMSInsolationSync] Error:", error)
    throw error
  }
}

