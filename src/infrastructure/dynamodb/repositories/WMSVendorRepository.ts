/**
 * DynamoDB WMS Vendor Repository Implementation
 * 
 * Implements WMSVendorRepository interface using DynamoDB.
 * Uses wms table (WMS_VENDOR entity type).
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
  WMSVendor,
  WMSVendorRepository,
  CreateWMSVendorInput,
} from "../../../domain/wms/WMS"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBWMSVendorRepository implements WMSVendorRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "wms") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: number): Promise<WMSVendor | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "WMS_VENDOR",
        SK: id.toString(),
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToWMSVendor(response.Item)
  }

  async findByOrgId(orgId: number): Promise<WMSVendor[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "wms-org-index",
      KeyConditionExpression: "GSI3PK = :gsi3pk AND begins_with(GSI3SK, :prefix)",
      ExpressionAttributeValues: {
        ":gsi3pk": `ORG#${orgId}`,
        ":prefix": "WMS_VENDOR#",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWMSVendor(item))
  }

  async findAll(): Promise<WMSVendor[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": "WMS_VENDOR",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWMSVendor(item))
  }

  async create(input: CreateWMSVendorInput): Promise<WMSVendor> {
    // Generate WMS vendor ID (in production, use a sequence)
    const vendorId = Date.now()
    const now = new Date()

    const vendor: WMSVendor = {
      id: vendorId,
      name: input.name,
      vendorType: input.vendorType,
      credentials: input.credentials,
      orgId: input.orgId,
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      tokenMetadata: {},
      isActive: input.isActive ?? true,
      lastSitesSyncedAt: null,
      lastInsolationSyncedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapWMSVendorToItem(vendor)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return vendor
  }

  async update(id: number, updates: Partial<WMSVendor>): Promise<WMSVendor> {
    // First get the vendor
    const existing = await this.findById(id)
    
    if (!existing) {
      throw new NotFoundError(`WMS vendor with id ${id} not found`)
    }

    const updated: WMSVendor = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapWMSVendorToItem(updated)

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
        PK: "WMS_VENDOR",
        SK: id.toString(),
      },
    })

    await this.client.send(command)
  }

  private mapItemToWMSVendor(item: any): WMSVendor {
    return {
      id: parseInt(item.SK, 10),
      name: item.name,
      vendorType: item.vendor_type,
      credentials: item.credentials || {},
      orgId: item.org_id,
      accessToken: item.access_token || null,
      refreshToken: item.refresh_token || null,
      tokenExpiresAt: item.token_expires_at ? new Date(item.token_expires_at) : null,
      tokenMetadata: item.token_metadata || {},
      isActive: item.is_active ?? true,
      lastSitesSyncedAt: item.last_sites_synced_at ? new Date(item.last_sites_synced_at) : null,
      lastInsolationSyncedAt: item.last_insolation_synced_at ? new Date(item.last_insolation_synced_at) : null,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapWMSVendorToItem(vendor: WMSVendor): any {
    return {
      PK: "WMS_VENDOR",
      SK: vendor.id.toString(),
      GSI1PK: `WMS_VENDOR#${vendor.id}`,
      GSI1SK: `WMS_VENDOR#${vendor.id}`, // Self-reference for vendor queries
      GSI3PK: `ORG#${vendor.orgId}`,
      GSI3SK: `WMS_VENDOR#${vendor.id}`,
      entity_type: "WMS_VENDOR",
      id: vendor.id,
      name: vendor.name,
      vendor_type: vendor.vendorType,
      credentials: vendor.credentials,
      org_id: vendor.orgId,
      access_token: vendor.accessToken || null,
      refresh_token: vendor.refreshToken || null,
      token_expires_at: vendor.tokenExpiresAt?.toISOString() || null,
      token_metadata: vendor.tokenMetadata || {},
      is_active: vendor.isActive,
      last_sites_synced_at: vendor.lastSitesSyncedAt?.toISOString() || null,
      last_insolation_synced_at: vendor.lastInsolationSyncedAt?.toISOString() || null,
      created_at: vendor.createdAt.toISOString(),
      updated_at: vendor.updatedAt.toISOString(),
    }
  }
}

