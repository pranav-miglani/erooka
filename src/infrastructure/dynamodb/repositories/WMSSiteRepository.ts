/**
 * DynamoDB WMS Site Repository Implementation
 * 
 * Implements WMSSiteRepository interface using DynamoDB.
 * Uses wms table (WMS_SITE entity type).
 */

import {
  DynamoDBDocumentClient,
  GetItemCommand,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  WMSSite,
  WMSSiteRepository,
  CreateWMSSiteInput,
} from "../../../domain/wms/WMS"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBWMSSiteRepository implements WMSSiteRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "wms") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: number): Promise<WMSSite | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "WMS_SITE",
        SK: id.toString(),
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToWMSSite(response.Item)
  }

  async findByVendorId(vendorId: number): Promise<WMSSite[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "wms-vendor-index",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: {
        ":gsi1pk": `WMS_VENDOR#${vendorId}`,
        ":prefix": "WMS_SITE#",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWMSSite(item))
  }

  async findByOrgId(orgId: number): Promise<WMSSite[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "wms-org-index",
      KeyConditionExpression: "GSI3PK = :gsi3pk AND begins_with(GSI3SK, :prefix)",
      ExpressionAttributeValues: {
        ":gsi3pk": `ORG#${orgId}`,
        ":prefix": "WMS_SITE#",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWMSSite(item))
  }

  async findByVendorAndVendorSiteId(
    vendorId: number,
    vendorSiteId: string
  ): Promise<WMSSite | null> {
    // Query by vendor, then filter by vendor_site_id
    const sites = await this.findByVendorId(vendorId)
    return sites.find((s) => s.vendorSiteId === vendorSiteId) || null
  }

  async create(input: CreateWMSSiteInput): Promise<WMSSite> {
    // Generate site ID (in production, use a sequence)
    const siteId = Date.now()
    const now = new Date()

    const site: WMSSite = {
      id: siteId,
      wmsVendorId: input.wmsVendorId,
      orgId: input.orgId,
      vendorSiteId: input.vendorSiteId,
      siteName: input.siteName,
      address: input.address || null,
      latitude: input.latitude || null,
      longitude: input.longitude || null,
      location: input.location || null,
      elevation: input.elevation || null,
      status: input.status || null,
      panelCount: input.panelCount || null,
      panelWattage: input.panelWattage || null,
      createdDate: input.createdDate || null,
      installerType: input.installerType || null,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapWMSSiteToItem(site)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return site
  }

  async update(id: number, updates: Partial<WMSSite>): Promise<WMSSite> {
    // First get the site
    const existing = await this.findById(id)
    
    if (!existing) {
      throw new NotFoundError(`WMS site with id ${id} not found`)
    }

    const updated: WMSSite = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapWMSSiteToItem(updated)

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
        PK: "WMS_SITE",
        SK: id.toString(),
      },
    })

    await this.client.send(command)
  }

  private mapItemToWMSSite(item: any): WMSSite {
    return {
      id: parseInt(item.SK, 10),
      wmsVendorId: item.wms_vendor_id,
      orgId: item.org_id,
      vendorSiteId: item.vendor_site_id,
      siteName: item.site_name,
      address: item.address || null,
      latitude: item.latitude || null,
      longitude: item.longitude || null,
      location: item.location || null,
      elevation: item.elevation || null,
      status: item.status || null,
      panelCount: item.panel_count || null,
      panelWattage: item.panel_wattage || null,
      createdDate: item.created_date ? new Date(item.created_date) : null,
      installerType: item.installer_type || null,
      metadata: item.metadata || {},
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapWMSSiteToItem(site: WMSSite): any {
    return {
      PK: "WMS_SITE",
      SK: site.id.toString(),
      GSI1PK: `WMS_VENDOR#${site.wmsVendorId}`,
      GSI1SK: `WMS_SITE#${site.id}`,
      GSI3PK: `ORG#${site.orgId}`,
      GSI3SK: `WMS_SITE#${site.id}`,
      entity_type: "WMS_SITE",
      id: site.id,
      wms_vendor_id: site.wmsVendorId,
      org_id: site.orgId,
      vendor_site_id: site.vendorSiteId,
      site_name: site.siteName,
      address: site.address || null,
      latitude: site.latitude || null,
      longitude: site.longitude || null,
      location: site.location || null,
      elevation: site.elevation || null,
      status: site.status || null,
      panel_count: site.panelCount || null,
      panel_wattage: site.panelWattage || null,
      created_date: site.createdDate?.toISOString().split("T")[0] || null,
      installer_type: site.installerType || null,
      metadata: site.metadata || {},
      created_at: site.createdAt.toISOString(),
      updated_at: site.updatedAt.toISOString(),
    }
  }
}

