/**
 * DynamoDB Alert Repository Implementation
 * 
 * Implements AlertRepository interface using DynamoDB.
 * Uses alerts table with multiple GSIs for efficient queries.
 * 
 * High volume time-series data (35K alerts/day = 1M/month).
 * TTL: 180 days (6 months retention).
 */

import {
  DynamoDBDocumentClient,
  GetItemCommand,
  QueryCommand,
  PutItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  Alert,
  AlertRepository,
  CreateAlertInput,
} from "../../../domain/alert/Alert"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBAlertRepository implements AlertRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "alerts") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: string): Promise<Alert | null> {
    // Use alert-id-index (GSI4) for direct lookup
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "alert-id-index",
      KeyConditionExpression: "GSI4PK = :gsi4pk",
      ExpressionAttributeValues: {
        ":gsi4pk": `ALERT#${id}`,
      },
      Limit: 1,
    })

    const response = await this.client.send(command)
    
    if (!response.Items || response.Items.length === 0) {
      return null
    }

    // Get the full item using PK/SK from GSI result
    const item = response.Items[0]
    const getCommand = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: item.PK,
        SK: item.SK,
      },
    })

    const getResponse = await this.client.send(getCommand)
    
    if (!getResponse.Item) {
      return null
    }

    return this.mapItemToAlert(getResponse.Item)
  }

  async findByPlantId(
    plantId: number,
    limit: number = 100,
    status?: string
  ): Promise<Alert[]> {
    // Use plant-alert-index (GSI2) - MOST COMMON QUERY
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "plant-alert-index",
      KeyConditionExpression: "GSI2PK = :gsi2pk",
      ExpressionAttributeValues: {
        ":gsi2pk": `PLANT#${plantId}`,
      },
      ScanIndexForward: false, // DESC order (newest first)
      Limit: Math.min(limit, 200), // Max 200
      ...(status && {
        FilterExpression: "#status = :status",
        ExpressionAttributeNames: {
          "#status": "status",
        },
        ExpressionAttributeValues: {
          ":gsi2pk": `PLANT#${plantId}`,
          ":status": status,
        },
      }),
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => {
      // Get full item using PK/SK
      // For now, map from GSI item (contains all fields)
      return this.mapItemToAlert(item)
    })
  }

  async findByVendorAndPlant(
    vendorId: number,
    vendorPlantId: string,
    vendorAlertId: string
  ): Promise<Alert | null> {
    // Use vendor-alert-index (GSI3) for deduplication
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "vendor-alert-index",
      KeyConditionExpression: "GSI3PK = :gsi3pk AND begins_with(GSI3SK, :prefix)",
      ExpressionAttributeValues: {
        ":gsi3pk": `VENDOR#${vendorId}#PLANT#${vendorPlantId}`,
        ":prefix": `${vendorAlertId}#`,
      },
      Limit: 1,
    })

    const response = await this.client.send(command)
    
    if (!response.Items || response.Items.length === 0) {
      return null
    }

    // Get full item using PK/SK from GSI result
    const item = response.Items[0]
    const getCommand = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: item.PK,
        SK: item.SK,
      },
    })

    const getResponse = await this.client.send(getCommand)
    
    if (!getResponse.Item) {
      return null
    }

    return this.mapItemToAlert(getResponse.Item)
  }

  async create(input: CreateAlertInput): Promise<Alert> {
    // Generate alert ID (in production, use a sequence or UUID)
    const alertId = Date.now().toString()
    const now = new Date()
    
    // Calculate TTL: alertTime + 180 days (6 months)
    const ttl = Math.floor((input.alertTime.getTime() / 1000) + (180 * 24 * 60 * 60))

    // Format timestamp for SK: ISO string format
    const timestampStr = input.alertTime.toISOString()

    const alert: Alert = {
      id: alertId,
      plantId: input.plantId,
      vendorId: input.vendorId,
      vendorAlertId: input.vendorAlertId || null,
      title: input.title,
      description: input.description || null,
      severity: input.severity,
      status: input.status || "ACTIVE",
      alertTime: input.alertTime,
      createdAt: now,
      updatedAt: now,
      ttl,
    }

    const item = this.mapAlertToItem(alert)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return alert
  }

  async update(id: string, updates: Partial<Alert>): Promise<Alert> {
    // First get the alert
    const existing = await this.findById(id)
    
    if (!existing) {
      throw new NotFoundError(`Alert with id ${id} not found`)
    }

    const updated: Alert = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapAlertToItem(updated)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return updated
  }

  async batchCreate(inputs: CreateAlertInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }

    // BatchWriteItem supports up to 25 items per batch
    const batches: CreateAlertInput[][] = []
    for (let i = 0; i < inputs.length; i += 25) {
      batches.push(inputs.slice(i, i + 25))
    }

    for (const batch of batches) {
      const writeRequests = batch.map((input) => {
        const alertId = Date.now().toString() + Math.random().toString(36).substr(2, 9)
        const now = new Date()
        const ttl = Math.floor((input.alertTime.getTime() / 1000) + (180 * 24 * 60 * 60))
        const timestampStr = input.alertTime.toISOString()

        const alert: Alert = {
          id: alertId,
          plantId: input.plantId,
          vendorId: input.vendorId,
          vendorAlertId: input.vendorAlertId || null,
          title: input.title,
          description: input.description || null,
          severity: input.severity,
          status: input.status || "ACTIVE",
          alertTime: input.alertTime,
          createdAt: now,
          updatedAt: now,
          ttl,
        }

        return {
          PutRequest: {
            Item: this.mapAlertToItem(alert),
          },
        }
      })

      const command = new BatchWriteItemCommand({
        RequestItems: {
          [this.tableName]: writeRequests,
        },
      })

      await this.client.send(command)
    }
  }

  private mapItemToAlert(item: any): Alert {
    // Parse SK to extract alert_id
    // SK format: TIMESTAMP#alert_id
    const skParts = item.SK.split("#")
    const alertId = skParts[skParts.length - 1]

    return {
      id: alertId,
      plantId: parseInt(item.PK.replace("PLANT#", ""), 10),
      vendorId: item.vendor_id,
      vendorAlertId: item.vendor_alert_id || null,
      title: item.title,
      description: item.description || null,
      severity: item.severity,
      status: item.status,
      alertTime: new Date(item.alert_time),
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
      ttl: item.ttl,
    }
  }

  private mapAlertToItem(alert: Alert): any {
    const timestampStr = alert.alertTime.toISOString()
    
    return {
      PK: `PLANT#${alert.plantId}`,
      SK: `${timestampStr}#${alert.id}`,
      GSI1PK: `DATE#${alert.alertTime.toISOString().split("T")[0]}`, // DATE#YYYY-MM-DD
      GSI1SK: `PLANT#${alert.plantId}`,
      GSI2PK: `PLANT#${alert.plantId}`,
      GSI2SK: `${timestampStr}#${alert.id}`,
      // GSI3PK requires vendor_plant_id - we'll need to get it from plant
      // For now, use a placeholder - will be fixed when we have vendor_plant_id in Alert entity
      GSI3PK: `VENDOR#${alert.vendorId}#PLANT#${(alert as any).vendorPlantId || alert.id}`,
      GSI3SK: `${alert.vendorAlertId || alert.id}#${timestampStr}`,
      GSI4PK: `ALERT#${alert.id}`,
      GSI4SK: `PLANT#${alert.plantId}`,
      id: alert.id,
      plant_id: alert.plantId,
      vendor_id: alert.vendorId,
      vendor_alert_id: alert.vendorAlertId || null,
      title: alert.title,
      description: alert.description || null,
      severity: alert.severity,
      status: alert.status,
      alert_time: alert.alertTime.toISOString(),
      created_at: alert.createdAt.toISOString(),
      updated_at: alert.updatedAt.toISOString(),
      ttl: alert.ttl,
    }
  }
}

