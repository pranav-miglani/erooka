/**
 * DynamoDB Insolation Reading Repository Implementation
 * 
 * Implements InsolationReadingRepository interface using DynamoDB.
 * Uses wms table (INSULATION entity type).
 * 
 * TTL: 100 days (reading_date + 100 days).
 */

import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  InsolationReading,
  InsolationReadingRepository,
  CreateInsolationReadingInput,
} from "../../../domain/wms/WMS"

export class DynamoDBInsolationReadingRepository implements InsolationReadingRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "wms") {
    this.client = client
    this.tableName = tableName
  }

  async findByDeviceId(
    deviceId: number,
    startDate?: Date,
    endDate?: Date,
    limit: number = 100
  ): Promise<InsolationReading[]> {
    // Query by device using date-index (GSI4) - need to query for each date in range
    // For now, use a simplified approach: query by device and filter by date
    // In production, would query date-index for each date in range
    
    if (startDate && endDate) {
      // Query for each date in range
      const readings: InsolationReading[] = []
      const currentDate = new Date(startDate)
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split("T")[0]
        const reading = await this.findByDeviceAndDate(deviceId, currentDate)
        if (reading) {
          readings.push(reading)
        }
        currentDate.setDate(currentDate.getDate() + 1)
        
        if (readings.length >= limit) {
          break
        }
      }
      
      return readings.sort((a, b) => b.readingDate.getTime() - a.readingDate.getTime())
    }

    // If no date range, return empty (would need device-index which we don't have)
    // For now, return empty - would need to add device-index GSI
    return []
  }

  async findByDate(date: Date): Promise<InsolationReading[]> {
    const dateStr = date.toISOString().split("T")[0]
    
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "insolation-date-index",
      KeyConditionExpression: "GSI4PK = :gsi4pk",
      ExpressionAttributeValues: {
        ":gsi4pk": `DATE#${dateStr}`,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToInsolationReading(item))
  }

  async findByDeviceAndDate(deviceId: number, date: Date): Promise<InsolationReading | null> {
    const dateStr = date.toISOString().split("T")[0]
    const sk = `${deviceId}#${dateStr}`
    
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "INSULATION",
        SK: sk,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToInsolationReading(response.Item)
  }

  async create(input: CreateInsolationReadingInput): Promise<InsolationReading> {
    const dateStr = input.readingDate.toISOString().split("T")[0]
    const sk = `${input.wmsDeviceId}#${dateStr}`
    
    // Calculate TTL: reading_date + 100 days
    const ttl = Math.floor((input.readingDate.getTime() / 1000) + (100 * 24 * 60 * 60))
    const now = new Date()

    const reading: InsolationReading = {
      id: sk,
      wmsDeviceId: input.wmsDeviceId,
      readingDate: input.readingDate,
      insolationValue: input.insolationValue,
      readingCount: input.readingCount,
      ttl,
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapInsolationReadingToItem(reading)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return reading
  }

  async batchCreate(inputs: CreateInsolationReadingInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }

    // BatchWriteItem supports up to 25 items per batch
    const batches: CreateInsolationReadingInput[][] = []
    for (let i = 0; i < inputs.length; i += 25) {
      batches.push(inputs.slice(i, i + 25))
    }

    const now = new Date()

    for (const batch of batches) {
      const writeRequests = batch.map((input) => {
        const dateStr = input.readingDate.toISOString().split("T")[0]
        const sk = `${input.wmsDeviceId}#${dateStr}`
        const ttl = Math.floor((input.readingDate.getTime() / 1000) + (100 * 24 * 60 * 60))

        const reading: InsolationReading = {
          id: sk,
          wmsDeviceId: input.wmsDeviceId,
          readingDate: input.readingDate,
          insolationValue: input.insolationValue,
          readingCount: input.readingCount,
          ttl,
          createdAt: now,
          updatedAt: now,
        }

        return {
          PutRequest: {
            Item: this.mapInsolationReadingToItem(reading),
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

  private mapItemToInsolationReading(item: any): InsolationReading {
    // Parse SK: device_id#date
    const skParts = item.SK.split("#")
    const deviceId = parseInt(skParts[0], 10)
    const dateStr = skParts[1]

    return {
      id: item.SK,
      wmsDeviceId: deviceId,
      readingDate: new Date(dateStr),
      insolationValue: item.insolation_value,
      readingCount: item.reading_count,
      ttl: item.ttl,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapInsolationReadingToItem(reading: InsolationReading): any {
    const dateStr = reading.readingDate.toISOString().split("T")[0]
    
    return {
      PK: "INSULATION",
      SK: `${reading.wmsDeviceId}#${dateStr}`,
      GSI4PK: `DATE#${dateStr}`,
      GSI4SK: `WMS_DEVICE#${reading.wmsDeviceId}`,
      id: reading.id,
      wms_device_id: reading.wmsDeviceId,
      reading_date: dateStr,
      insolation_value: reading.insolationValue,
      reading_count: reading.readingCount,
      ttl: reading.ttl,
      created_at: reading.createdAt.toISOString(),
      updated_at: reading.updatedAt.toISOString(),
    }
  }
}

