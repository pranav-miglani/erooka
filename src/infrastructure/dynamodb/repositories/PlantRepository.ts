/**
 * DynamoDB Plant Repository Implementation
 * 
 * Implements PlantRepository interface using DynamoDB.
 * Uses plants table with multiple GSIs for efficient queries.
 * 
 * Optimized for high write volume (7K plants updated every 15 minutes).
 */

import {
  DynamoDBDocumentClient,
  GetItemCommand,
  ScanCommand,
  QueryCommand,
  PutItemCommand,
  DeleteItemCommand,
  BatchGetItemCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/lib-dynamodb"
import type {
  Plant,
  PlantRepository,
  CreatePlantInput,
  UpdatePlantInput,
} from "../../../domain/plant/Plant"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBPlantRepository implements PlantRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "plants") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: number): Promise<Plant | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: `PLANT#${id}`,
        SK: `PLANT#${id}`,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToPlant(response.Item)
  }

  async findByVendorAndVendorPlantId(
    vendorId: number,
    vendorPlantId: string
  ): Promise<Plant | null> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "vendor-plant-unique-index",
      KeyConditionExpression: "GSI3PK = :gsi3pk AND GSI3SK = :gsi3sk",
      ExpressionAttributeValues: {
        ":gsi3pk": `VENDOR#${vendorId}`,
        ":gsi3sk": `PLANT#${vendorPlantId}`,
      },
      Limit: 1,
    })

    const response = await this.client.send(command)
    
    if (!response.Items || response.Items.length === 0) {
      return null
    }

    return this.mapItemToPlant(response.Items[0])
  }

  async findByOrgId(orgId: number): Promise<Plant[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "org-index",
      KeyConditionExpression: "GSI1PK = :gsi1pk",
      ExpressionAttributeValues: {
        ":gsi1pk": `ORG#${orgId}`,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToPlant(item))
  }

  async findByVendorId(vendorId: number): Promise<Plant[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "vendor-index",
      KeyConditionExpression: "GSI2PK = :gsi2pk",
      ExpressionAttributeValues: {
        ":gsi2pk": `VENDOR#${vendorId}`,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToPlant(item))
  }

  async findByPlantIds(plantIds: number[]): Promise<Plant[]> {
    if (plantIds.length === 0) {
      return []
    }

    // BatchGetItem supports up to 100 items, but we'll use 25 per batch for safety
    const batches: number[][] = []
    for (let i = 0; i < plantIds.length; i += 25) {
      batches.push(plantIds.slice(i, i + 25))
    }

    const allItems: any[] = []

    for (const batch of batches) {
      const keys = batch.map((id) => ({
        PK: `PLANT#${id}`,
        SK: `PLANT#${id}`,
      }))

      const command = new BatchGetItemCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keys,
          },
        },
      })

      const response = await this.client.send(command)
      
      if (response.Responses && response.Responses[this.tableName]) {
        allItems.push(...response.Responses[this.tableName])
      }
    }

    return allItems.map((item) => this.mapItemToPlant(item))
  }

  async findAll(): Promise<Plant[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToPlant(item))
  }

  async create(input: CreatePlantInput): Promise<Plant> {
    // Generate new plant ID (in production, use a sequence or UUID)
    const plantId = Date.now()
    const now = new Date()

    const plant: Plant = {
      id: plantId,
      orgId: input.orgId,
      vendorId: input.vendorId,
      vendorPlantId: input.vendorPlantId,
      name: input.name,
      capacityKw: input.capacityKw,
      location: input.location || {},
      currentPowerKw: null,
      dailyEnergyKwh: null,
      monthlyEnergyMwh: null,
      yearlyEnergyMwh: null,
      totalEnergyMwh: null,
      isOnline: null,
      isActive: true,
      lastUpdateTime: null,
      lastRefreshedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapPlantToItem(plant)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return plant
  }

  async update(id: number, updates: UpdatePlantInput): Promise<Plant> {
    const existing = await this.findById(id)
    if (!existing) {
      throw new NotFoundError("Plant")
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapPlantToItem(updated)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return updated
  }

  async batchUpdate(
    updates: Array<{ id: number; updates: UpdatePlantInput }>
  ): Promise<void> {
    if (updates.length === 0) {
      return
    }

    // BatchWriteItem supports up to 25 items per batch
    const batches: Array<{ id: number; updates: UpdatePlantInput }>[] = []
    for (let i = 0; i < updates.length; i += 25) {
      batches.push(updates.slice(i, i + 25))
    }

    // First, fetch all existing plants
    const plantIds = updates.map((u) => u.id)
    const existingPlants = await this.findByPlantIds(plantIds)
    const plantMap = new Map(existingPlants.map((p) => [p.id, p]))

    for (const batch of batches) {
      const writeRequests = batch.map(({ id, updates: updateData }) => {
        const existing = plantMap.get(id)
        if (!existing) {
          throw new NotFoundError(`Plant ${id}`)
        }

        const updated = {
          ...existing,
          ...updateData,
          updatedAt: new Date(),
        }

        return {
          PutRequest: {
            Item: this.mapPlantToItem(updated),
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

  async delete(id: number): Promise<void> {
    const existing = await this.findById(id)
    if (!existing) {
      throw new NotFoundError("Plant")
    }

    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: {
        PK: `PLANT#${id}`,
        SK: `PLANT#${id}`,
      },
    })

    await this.client.send(command)
  }

  private mapItemToPlant(item: any): Plant {
    return {
      id: parseInt(item.PK.replace("PLANT#", "")),
      orgId: parseInt(item.org_id),
      vendorId: parseInt(item.vendor_id),
      vendorPlantId: item.vendor_plant_id,
      name: item.name,
      capacityKw: item.capacity_kw,
      location: item.location || {},
      currentPowerKw: item.current_power_kw ?? null,
      dailyEnergyKwh: item.daily_energy_kwh ?? null,
      monthlyEnergyMwh: item.monthly_energy_mwh ?? null,
      yearlyEnergyMwh: item.yearly_energy_mwh ?? null,
      totalEnergyMwh: item.total_energy_mwh ?? null,
      isOnline: item.is_online ?? null,
      isActive: item.is_active ?? true,
      lastUpdateTime: item.last_update_time ? new Date(item.last_update_time) : null,
      lastRefreshedAt: item.last_refreshed_at ? new Date(item.last_refreshed_at) : null,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapPlantToItem(plant: Plant): any {
    const item: any = {
      PK: `PLANT#${plant.id}`,
      SK: `PLANT#${plant.id}`,
      GSI1PK: `ORG#${plant.orgId}`,
      GSI1SK: `PLANT#${plant.id}`,
      GSI2PK: `VENDOR#${plant.vendorId}`,
      GSI2SK: `PLANT#${plant.id}`,
      GSI3PK: `VENDOR#${plant.vendorId}`,
      GSI3SK: `PLANT#${plant.vendorPlantId}`,
      org_id: plant.orgId,
      vendor_id: plant.vendorId,
      vendor_plant_id: plant.vendorPlantId,
      name: plant.name,
      capacity_kw: plant.capacityKw,
      location: plant.location,
      is_active: plant.isActive,
      created_at: plant.createdAt.toISOString(),
      updated_at: plant.updatedAt.toISOString(),
    }

    if (plant.currentPowerKw !== null) {
      item.current_power_kw = plant.currentPowerKw
    }
    if (plant.dailyEnergyKwh !== null) {
      item.daily_energy_kwh = plant.dailyEnergyKwh
    }
    if (plant.monthlyEnergyMwh !== null) {
      item.monthly_energy_mwh = plant.monthlyEnergyMwh
    }
    if (plant.yearlyEnergyMwh !== null) {
      item.yearly_energy_mwh = plant.yearlyEnergyMwh
    }
    if (plant.totalEnergyMwh !== null) {
      item.total_energy_mwh = plant.totalEnergyMwh
    }
    if (plant.isOnline !== null) {
      item.is_online = plant.isOnline
    }
    if (plant.lastUpdateTime !== null) {
      item.last_update_time = plant.lastUpdateTime.toISOString()
    }
    if (plant.lastRefreshedAt !== null) {
      item.last_refreshed_at = plant.lastRefreshedAt.toISOString()
    }

    return item
  }
}

