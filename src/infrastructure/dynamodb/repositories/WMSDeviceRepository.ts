/**
 * DynamoDB WMS Device Repository Implementation
 * 
 * Implements WMSDeviceRepository interface using DynamoDB.
 * Uses wms table (WMS_DEVICE entity type).
 */

import {
  DynamoDBDocumentClient,
  GetItemCommand,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  WMSDevice,
  WMSDeviceRepository,
  CreateWMSDeviceInput,
} from "../../../domain/wms/WMS"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBWMSDeviceRepository implements WMSDeviceRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "wms") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: number): Promise<WMSDevice | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "WMS_DEVICE",
        SK: id.toString(),
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToWMSDevice(response.Item)
  }

  async findBySiteId(siteId: number): Promise<WMSDevice[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "wms-site-index",
      KeyConditionExpression: "GSI2PK = :gsi2pk",
      ExpressionAttributeValues: {
        ":gsi2pk": `WMS_SITE#${siteId}`,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWMSDevice(item))
  }

  async findByVendorId(vendorId: number): Promise<WMSDevice[]> {
    // Query via vendor-index (GSI1)
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "wms-vendor-index",
      KeyConditionExpression: "GSI1PK = :gsi1pk AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: {
        ":gsi1pk": `WMS_VENDOR#${vendorId}`,
        ":prefix": "WMS_DEVICE#",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToWMSDevice(item))
  }

  async findBySiteAndVendorDeviceId(
    siteId: number,
    vendorDeviceId: string
  ): Promise<WMSDevice | null> {
    // Query by site, then filter by vendor_device_id
    const devices = await this.findBySiteId(siteId)
    return devices.find((d) => d.vendorDeviceId === vendorDeviceId) || null
  }

  async create(input: CreateWMSDeviceInput): Promise<WMSDevice> {
    // Generate device ID (in production, use a sequence)
    const deviceId = Date.now()
    const now = new Date()

    const device: WMSDevice = {
      id: deviceId,
      wmsSiteId: input.wmsSiteId,
      vendorDeviceId: input.vendorDeviceId,
      deviceName: input.deviceName || null,
      macAddress: input.macAddress || null,
      serialNo: input.serialNo || null,
      metadata: input.metadata || {},
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapWMSDeviceToItem(device)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return device
  }

  async update(id: number, updates: Partial<WMSDevice>, wmsVendorId?: number): Promise<WMSDevice> {
    // First get the device
    const existing = await this.findById(id)
    
    if (!existing) {
      throw new NotFoundError(`WMS device with id ${id} not found`)
    }

    const updated: WMSDevice = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    // Get vendor_id from existing item or parameter
    const vendorId = wmsVendorId || (existing as any).wmsVendorId || (existing as any).wms_vendor_id
    const item = this.mapWMSDeviceToItem(updated, vendorId)

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
        PK: "WMS_DEVICE",
        SK: id.toString(),
      },
    })

    await this.client.send(command)
  }

  private mapItemToWMSDevice(item: any): WMSDevice {
    const device: WMSDevice = {
      id: parseInt(item.SK, 10),
      wmsSiteId: item.wms_site_id,
      vendorDeviceId: item.vendor_device_id,
      deviceName: item.device_name || null,
      macAddress: item.mac_address || null,
      serialNo: item.serial_no || null,
      metadata: item.metadata || {},
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
    
    // Store vendor_id in metadata for reference
    if (item.wms_vendor_id) {
      (device as any).wmsVendorId = item.wms_vendor_id
    }
    
    return device
  }

  private mapWMSDeviceToItem(device: WMSDevice, wmsVendorId?: number): any {
    // GSI1 requires vendor_id - we'll need to get it from site
    // For now, accept it as parameter or store in device metadata
    const vendorId = wmsVendorId || (device as any).wmsVendorId || 0
    
    return {
      PK: "WMS_DEVICE",
      SK: device.id.toString(),
      GSI1PK: `WMS_VENDOR#${vendorId}`,
      GSI1SK: `WMS_DEVICE#${device.id}`,
      GSI2PK: `WMS_SITE#${device.wmsSiteId}`,
      GSI2SK: `WMS_DEVICE#${device.id}`,
      entity_type: "WMS_DEVICE",
      id: device.id,
      wms_site_id: device.wmsSiteId,
      wms_vendor_id: vendorId, // Store for reference
      vendor_device_id: device.vendorDeviceId,
      device_name: device.deviceName || null,
      mac_address: device.macAddress || null,
      serial_no: device.serialNo || null,
      metadata: device.metadata || {},
      created_at: device.createdAt.toISOString(),
      updated_at: device.updatedAt.toISOString(),
    }
  }

  // Helper method to get vendor_id from site
  private async getVendorIdFromSite(siteId: number): Promise<number | null> {
    // This would require WMSSiteRepository - for now, return null and handle in service layer
    return null
  }
}

