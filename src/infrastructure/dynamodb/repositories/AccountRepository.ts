/**
 * DynamoDB Account Repository Implementation
 * 
 * Implements AccountRepository interface using DynamoDB.
 * Uses config table with email-index GSI for login queries.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient, QueryCommand, GetItemCommand, PutItemCommand, ScanCommand } from "@aws-sdk/lib-dynamodb"
import { randomUUID } from "crypto"
import type { Account, AccountRepository, CreateAccountInput } from "../../../domain/account/Account"
import { ConflictError, NotFoundError } from "../../../shared/errors"

export class DynamoDBAccountRepository implements AccountRepository {
  private client: DynamoDBDocumentClient
  private tableName: string

  constructor(client: DynamoDBDocumentClient, tableName: string = "config") {
    this.client = client
    this.tableName = tableName
  }

  async findByEmail(email: string): Promise<Account | null> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "email-index",
      KeyConditionExpression: "GSI3PK = :email",
      FilterExpression: "is_active = :active",
      ExpressionAttributeValues: {
        ":email": `EMAIL#${email}`,
        ":active": true,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items || response.Items.length === 0) {
      return null
    }

    return this.mapItemToAccount(response.Items[0])
  }

  async findById(id: string): Promise<Account | null> {
    const command = new GetItemCommand({
      TableName: this.tableName,
      Key: {
        PK: "ACCOUNT",
        SK: id,
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Item) {
      return null
    }

    return this.mapItemToAccount(response.Item)
  }

  async findByOrgId(orgId: number): Promise<Account | null> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: "org-index",
      KeyConditionExpression: "GSI1PK = :orgId AND begins_with(GSI1SK, :prefix)",
      ExpressionAttributeValues: {
        ":orgId": `ORG#${orgId}`,
        ":prefix": "ACCOUNT#",
      },
      FilterExpression: "account_type = :type",
      ExpressionAttributeValues: {
        ":orgId": `ORG#${orgId}`,
        ":prefix": "ACCOUNT#",
        ":type": "ORG",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items || response.Items.length === 0) {
      return null
    }

    return this.mapItemToAccount(response.Items[0])
  }

  async create(input: CreateAccountInput): Promise<Account> {
    // Check if email already exists
    const existing = await this.findByEmail(input.email)
    if (existing) {
      throw new ConflictError("Account with this email already exists")
    }

    // For ORG accounts, check if org already has an account
    if (input.accountType === "ORG" && input.orgId) {
      const orgAccount = await this.findByOrgId(input.orgId)
      if (orgAccount) {
        throw new ConflictError("This organization already has an account")
      }
    }

    const accountId = randomUUID()
    const now = new Date()

    const account: Account = {
      id: accountId,
      email: input.email,
      passwordHash: input.password, // Will be hashed in service layer
      accountType: input.accountType,
      orgId: input.orgId ?? null,
      displayName: input.displayName ?? null,
      logoUrl: input.logoUrl ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }

    const item = this.mapAccountToItem(account)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)",
    })

    await this.client.send(command)

    return account
  }

  async update(id: string, updates: Partial<Account>): Promise<Account> {
    const existing = await this.findById(id)
    if (!existing) {
      throw new NotFoundError("Account")
    }

    const updated = {
      ...existing,
      ...updates,
      updatedAt: new Date(),
    }

    const item = this.mapAccountToItem(updated)

    const command = new PutItemCommand({
      TableName: this.tableName,
      Item: item,
    })

    await this.client.send(command)

    return updated
  }

  async findAll(): Promise<Account[]> {
    const command = new ScanCommand({
      TableName: this.tableName,
      FilterExpression: "PK = :pk",
      ExpressionAttributeValues: {
        ":pk": "ACCOUNT",
      },
    })

    const response = await this.client.send(command)
    
    if (!response.Items) {
      return []
    }

    return response.Items.map((item) => this.mapItemToAccount(item))
  }

  private mapItemToAccount(item: any): Account {
    return {
      id: item.SK,
      email: item.email,
      passwordHash: item.password_hash,
      accountType: item.account_type,
      orgId: item.org_id ?? null,
      displayName: item.display_name ?? null,
      logoUrl: item.logo_url ?? null,
      isActive: item.is_active ?? true,
      createdAt: new Date(item.created_at),
      updatedAt: new Date(item.updated_at),
    }
  }

  private mapAccountToItem(account: Account): any {
    const item: any = {
      PK: "ACCOUNT",
      SK: account.id,
      GSI3PK: `EMAIL#${account.email}`,
      GSI3SK: `ACCOUNT#${account.id}`,
      email: account.email,
      password_hash: account.passwordHash,
      account_type: account.accountType,
      is_active: account.isActive,
      created_at: account.createdAt.toISOString(),
      updated_at: account.updatedAt.toISOString(),
    }

    if (account.orgId !== null) {
      item.GSI1PK = `ORG#${account.orgId}`
      item.GSI1SK = `ACCOUNT#${account.id}`
      item.org_id = account.orgId
    }

    if (account.displayName) {
      item.display_name = account.displayName
    }

    if (account.logoUrl) {
      item.logo_url = account.logoUrl
    }

    return item
  }
}

