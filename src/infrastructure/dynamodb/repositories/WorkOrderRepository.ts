/**
 * DynamoDB Work Order Repository Implementation
 * 
 * Implements WorkOrderRepository interface using DynamoDB.
 * Uses config table (WORK_ORDER entity type).
 */

import {
  DynamoDBDocumentClient,
  GetItemCommand,
  QueryCommand,
  ScanCommand,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  WorkOrder,
  WorkOrderRepository,
  CreateWorkOrderInput,
  UpdateWorkOrderInput,
} from "../../../domain/workorder/WorkOrder"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBWorkOrderRepository implements WorkOrderRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "config") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: number): Promise<WorkOrder | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "WORK_ORDER",
        SK: id.toString(),
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToWorkOrder(response.Item)
  }

  async findByOrgId(orgId: number): Promise<WorkOrder[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "org-index",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: {
        ":gsi1pk": `ORG#${orgId}`,
        ":prefix": "WORK_ORDER#",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWorkOrder(item))
  }

  async findAll(): Promise<WorkOrder[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": "WORK_ORDER",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWorkOrder(item))
  }

  async create(input: CreateWorkOrderInput): Promise<WorkOrder> {
    // Generate work order ID (in production, use a sequence)
    const workOrderId = Date.now()
    const now = new Date()

    const workOrder: WorkOrder = {
      id: workOrderId,
      title: input.title,
      description: input.description || null,
      orgId: input.orgId,
      wmsDeviceId: input.wmsDeviceId || null,
      createdBy: input.createdBy || null,
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapWorkOrderToItem(workOrder)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return workOrder
  }

  async update(id: number, updates: UpdateWorkOrderInput): Promise<WorkOrder> {
    // First get the work order
    const existing = await this.findById(id)
    
    if (!existing) {
      throw new NotFoundError(`Work order with id ${id} not found`)
    }

    const updated: WorkOrder = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapWorkOrderToItem(updated)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return updated
  }

  async delete(id: number): Promise<void> {
    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "WORK_ORDER",
        SK: id.toString(),
      },
    })

    await this.client.send(command)
  }

  private mapItemToWorkOrder(item: any): WorkOrder {
    return {
      id: parseInt(item.SK, 10),
      title: item.title,
      description: item.description || null,
      orgId: item.org_id,
      wmsDeviceId: item.wms_device_id || null,
      createdBy: item.created_by || null,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapWorkOrderToItem(workOrder: WorkOrder): any {
    return {
      PK: "WORK_ORDER",
      SK: workOrder.id.toString(),
      GSI1PK: `ORG#${workOrder.orgId}`,
      GSI1SK: `WORK_ORDER#${workOrder.id}`,
      entity_type: "WORK_ORDER",
      id: workOrder.id,
      title: workOrder.title,
      description: workOrder.description || null,
      org_id: workOrder.orgId,
      wms_device_id: workOrder.wmsDeviceId || null,
      created_by: workOrder.createdBy || null,
      created_at: workOrder.createdAt.toISOString(),
      updated_at: workOrder.updatedAt.toISOString(),
    }
  }
}

