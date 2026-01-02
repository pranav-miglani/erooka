/**
 * DynamoDB Work Order Plant Repository Implementation
 * 
 * Implements WorkOrderPlantRepository interface using DynamoDB.
 * Uses work-order-plants table.
 * 
 * Enforces one active work order per plant.
 */

import {
  DynamoDBDocumentClient,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
  BatchWriteItemCommand,
  UpdateItemCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  WorkOrderPlant,
  WorkOrderPlantRepository,
} from "../../../domain/workorder/WorkOrder"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBWorkOrderPlantRepository implements WorkOrderPlantRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "work-order-plants") {
    this.client = client
    this.tableName = tableName
  }

  async findByWorkOrderId(workOrderId: number): Promise<WorkOrderPlant[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": `WORK_ORDER#${workOrderId}`,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWorkOrderPlant(item))
  }

  async findByPlantId(plantId: number): Promise<WorkOrderPlant[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "plant-workorder-index",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": `PLANT#${plantId}`,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWorkOrderPlant(item))
  }

  async findByWorkOrderIdAndActive(
    workOrderId: number,
    isActive: boolean
  ): Promise<WorkOrderPlant[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      KeyConditionExpression: "PK = :pk",
      FilterExpression: "is_active = :active",
      ExpressionAttributeValues: {
        ":pk": `WORK_ORDER#${workOrderId}`,
        ":active": isActive,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWorkOrderPlant(item))
  }

  async create(mapping: Omit<WorkOrderPlant, "addedAt">): Promise<WorkOrderPlant> {
    const now = new Date()

    const workOrderPlant: WorkOrderPlant = {
      ...mapping,
      addedAt: now,
    }

    const item = this.mapWorkOrderPlantToItem(workOrderPlant)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return workOrderPlant
  }

  async update(
    workOrderId: number,
    plantId: number,
    updates: Partial<WorkOrderPlant>
  ): Promise<WorkOrderPlant> {
    // First get the mapping
    const existing = await this.findByWorkOrderId(workOrderId)
    const mapping = existing.find((m) => m.plantId === plantId)
    
    if (!mapping) {
      throw new NotFoundError(
        `Work order plant mapping not found for work order ${workOrderId} and plant ${plantId}`
      )
    }

    const updated: WorkOrderPlant = {
      ...mapping,
      ...updates,
    }

    const item = this.mapWorkOrderPlantToItem(updated)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return updated
  }

  async delete(workOrderId: number, plantId: number): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: {
        PK: `WORK_ORDER#${workOrderId}`,
        SK: `PLANT#${plantId}`,
      },
    })

    await this.client.send(command)
  }

  async batchCreate(mappings: Omit<WorkOrderPlant, "addedAt">[]): Promise<void> {
    if (mappings.length === 0) {
      return
    }

    // BatchWriteItem supports up to 25 items per batch
    const batches: Omit<WorkOrderPlant, "addedAt">[][] = []
    for (let i = 0; i < mappings.length; i += 25) {
      batches.push(mappings.slice(i, i + 25))
    }

    const now = new Date()

    for (const batch of batches) {
      const writeRequests = batch.map((mapping) => {
        const workOrderPlant: WorkOrderPlant = {
          ...mapping,
          addedAt: now,
        }

        return {
          PutRequest: {
            Item: this.mapWorkOrderPlantToItem(workOrderPlant),
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

  async batchUpdate(
    workOrderId: number,
    plantIds: number[],
    isActive: boolean
  ): Promise<void> {
    if (plantIds.length === 0) {
      return
    }

    // Update each plant mapping
    const updatePromises = plantIds.map((plantId) =>
      this.update(workOrderId, plantId, { isActive })
    )

    await Promise.all(updatePromises)
  }

  private mapItemToWorkOrderPlant(item: any): WorkOrderPlant {
    return {
      workOrderId: parseInt(item.PK.replace("WORK_ORDER#", ""), 10),
      plantId: parseInt(item.SK.replace("PLANT#", ""), 10),
      isActive: item.is_active,
      addedAt: new Date(item.added_at),
    }
  }

  private mapWorkOrderPlantToItem(mapping: WorkOrderPlant): any {
    return {
      PK: `WORK_ORDER#${mapping.workOrderId}`,
      SK: `PLANT#${mapping.plantId}`,
      GSI1PK: `PLANT#${mapping.plantId}`,
      GSI1SK: `WORK_ORDER#${mapping.workOrderId}`,
      work_order_id: mapping.workOrderId,
      plant_id: mapping.plantId,
      is_active: mapping.isActive,
      added_at: mapping.addedAt.toISOString(),
    }
  }
}

