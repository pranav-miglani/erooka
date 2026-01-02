/**
 * DynamoDB Organization Repository Implementation
 * 
 * Implements OrganizationRepository interface using DynamoDB.
 * Uses config table with org-index GSI for queries.
 */

import { DynamoDBDocumentClient, GetItemCommand, ScanCommand, PutItemCommand, DeleteItemCommand } from "@aws-sdk/lib-dynamodb"
import type { Organization, OrganizationRepository, CreateOrganizationInput } from "../../../domain/organization/Organization"
import { NotFoundError } from "../../../shared/errors"

export class DynamoDBOrganizationRepository implements OrganizationRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "config") {
    this.client = client
    this.tableName = tableName
  }

  async findById(id: number): Promise<Organization | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "ORG",
        SK: id.toString(),
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToOrganization(response.Item)
  }

  async findAll(): Promise<Organization[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": "ORG",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToOrganization(item))
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    // Generate new org ID (in production, use a sequence or UUID)
    // For now, we'll use timestamp-based ID
    const orgId = Date.now()
    const now = new Date()

    const organization: Organization = {
      id: orgId,
      name: input.name,
      autoSyncEnabled: input.autoSyncEnabled ?? null,
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapOrganizationToItem(organization)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return organization
  }

  async update(id: number, updates: Partial<Organization>): Promise<Organization> {
    const existing = await this.findById(id)
    if (!existing) {
      throw new NotFoundError("Organization")
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapOrganizationToItem(updated)

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
      throw new NotFoundError("Organization")
    }

    const command = new DeleteItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "ORG",
        SK: id.toString(),
      },
    })

    await this.client.send(command)
  }

  private mapItemToOrganization(item: any): Organization {
    return {
      id: parseInt(item.SK),
      name: item.name,
      autoSyncEnabled: item.auto_sync_enabled ?? null,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapOrganizationToItem(org: Organization): any {
    const item: any = {
      PK: "ORG",
      SK: org.id.toString(),
      GSI1PK: `ORG#${org.id}`,
      GSI1SK: `ORG#${org.id}`,
      name: org.name,
      created_at: org.createdAt.toISOString(),
      updated_at: org.updatedAt.toISOString(),
    }

    if (org.autoSyncEnabled !== null) {
      item.auto_sync_enabled = org.autoSyncEnabled
    }

    return item
  }
}

