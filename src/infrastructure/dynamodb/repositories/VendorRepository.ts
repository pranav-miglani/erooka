/**
 * DynamoDB Vendor Repository Implementation
 * 
 * Implements VendorRepository interface using DynamoDB.
 * Uses config table with org-index and vendor-index GSIs for queries.
 */

import { DynamoDBDocumentClient, GetItemCommand, ScanCommand, QueryCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/lib-dynamodb"
import type { Vendor, VendorRepository, CreateVendorInput } from "../../../domain/vendor/Vendor"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBVendorRepository implements VendorRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "config") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: number): Promise<Vendor | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "VENDOR",
        SK: id.toString(),
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToVendor(response.Item)
  }

  async findAll(): Promise<Vendor[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": "VENDOR",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToVendor(item))
  }

  async findByOrgId(orgId: number): Promise<Vendor[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "org-index",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: {
        ":gsi1pk": `ORG#${orgId}`,
        ":prefix": "VENDOR#",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToVendor(item))
  }

  async create(input: CreateVendorInput): Promise<Vendor> {
    // Generate new vendor ID (in production, use a sequence or UUID)
    const vendorId = Date.now()
    const now = new Date()

    const vendor: Vendor = {
      id: vendorId,
      name: input.name,
      vendorType: input.vendorType,
      credentials: input.credentials,
      orgId: input.orgId,
      isActive: input.isActive ?? true,
      plantSyncMode: input.plantSyncMode ?? null,
      perPlantSyncIntervalMinutes: input.perPlantSyncIntervalMinutes ?? null,
      plantSyncTimeIst: input.plantSyncTimeIst ?? null,
      telemetrySyncMode: input.telemetrySyncMode ?? null,
      telemetrySyncInterval: input.telemetrySyncInterval ?? null,
      lastSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapVendorToItem(vendor)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return vendor
  }

  async update(id: number, updates: Partial<Vendor>): Promise<Vendor> {
    const existing = await this.findById(id)
    if (!existing) {
      throw new NotFoundError("Vendor")
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapVendorToItem(updated)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return updated
  }

  async delete(id: number): Promise<void> {
    const existing = await this.findById(id)
    if (!existing) {
      throw new NotFoundError("Vendor")
    }

    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "VENDOR",
        SK: id.toString(),
      },
    })

    await this.client.send(command)
  }

  private mapItemToVendor(item: any): Vendor {
    return {
      id: parseInt(item.SK),
      name: item.name,
      vendorType: item.vendor_type,
      credentials: item.credentials || {},
      orgId: parseInt(item.org_id),
      isActive: item.is_active ?? true,
      plantSyncMode: item.plant_sync_mode ?? null,
      perPlantSyncIntervalMinutes: item.per_plant_sync_interval_minutes ?? null,
      plantSyncTimeIst: item.plant_sync_time_ist ?? null,
      telemetrySyncMode: item.telemetry_sync_mode ?? null,
      telemetrySyncInterval: item.telemetry_sync_interval ?? null,
      lastSyncedAt: item.last_synced_at ? new Date(item.last_synced_at) : null,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapVendorToItem(vendor: Vendor): any {
    const item: any = {
      PK: "VENDOR",
      SK: vendor.id.toString(),
      GSI1PK: `ORG#${vendor.orgId}`,
      GSI1SK: `VENDOR#${vendor.id}`,
      GSI2PK: `VENDOR#${vendor.id}`,
      GSI2SK: `VENDOR#${vendor.id}`,
      name: vendor.name,
      vendor_type: vendor.vendorType,
      credentials: vendor.credentials,
      org_id: vendor.orgId,
      is_active: vendor.isActive,
      created_at: vendor.createdAt.toISOString(),
      updated_at: vendor.updatedAt.toISOString(),
    }

    if (vendor.plantSyncMode !== null) {
      item.plant_sync_mode = vendor.plantSyncMode
    }
    if (vendor.perPlantSyncIntervalMinutes !== null) {
      item.per_plant_sync_interval_minutes = vendor.perPlantSyncIntervalMinutes
    }
    if (vendor.plantSyncTimeIst !== null) {
      item.plant_sync_time_ist = vendor.plantSyncTimeIst
    }
    if (vendor.telemetrySyncMode !== null) {
      item.telemetry_sync_mode = vendor.telemetrySyncMode
    }
    if (vendor.telemetrySyncInterval !== null) {
      item.telemetry_sync_interval = vendor.telemetrySyncInterval
    }
    if (vendor.lastSyncedAt !== null) {
      item.last_synced_at = vendor.lastSyncedAt.toISOString()
    }

    return item
  }
}

