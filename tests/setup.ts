/**
 * Jest Test Setup
 * 
 * Global test configuration and mocks
 */

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(),
}))

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(),
  },
  GetItemCommand: jest.fn(),
  PutItemCommand: jest.fn(),
  DeleteItemCommand: jest.fn(),
  QueryCommand: jest.fn(),
  ScanCommand: jest.fn(),
  BatchGetItemCommand: jest.fn(),
  BatchWriteItemCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
}))

