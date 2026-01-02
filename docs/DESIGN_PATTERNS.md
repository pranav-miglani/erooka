# Design Patterns & SOLID Principles

This document outlines the design patterns and SOLID principles applied throughout the Erooka codebase.

## SOLID Principles

### 1. Single Responsibility Principle (SRP)

**Domain Layer**:
- Each entity (Account, Organization, Vendor, Plant, Alert, WorkOrder) has a single responsibility
- Entities contain only business logic and validation rules
- No infrastructure concerns in domain models

**Application Layer**:
- Services handle one use case each:
  - `AuthService` - Authentication only
  - `AccountService` - Account management only
  - `PlantService` - Plant management only
  - `AlertService` - Alert management only

**Infrastructure Layer**:
- Repositories handle data persistence only
- Vendor adapters handle vendor API communication only
- No business logic in infrastructure

**Interface Layer**:
- API handlers handle HTTP concerns only (request/response, validation, error formatting)
- Event handlers handle event processing only

### 2. Open/Closed Principle (OCP)

**Vendor Adapter System**:
- `BaseVendorAdapter` is open for extension (new vendor types)
- Closed for modification (existing adapters don't change)
- New vendors: Extend `BaseVendorAdapter`, register with `VendorManager`

**Repository Pattern**:
- `IAccountRepository` interface allows different implementations
- Can swap DynamoDB for another database without changing services
- Open for extension (new repository types), closed for modification

**Service Layer**:
- Services depend on interfaces, not concrete implementations
- Can extend behavior without modifying existing code

### 3. Liskov Substitution Principle (LSP)

**Vendor Adapters**:
- All vendor adapters must implement `BaseVendorAdapter` contract
- Any adapter can be substituted without breaking the system
- `VendorManager.getAdapter()` returns a `BaseVendorAdapter` that works identically

**Repositories**:
- All repository implementations follow the same interface contract
- `DynamoDBAccountRepository` can be replaced with `MockAccountRepository` in tests

### 4. Interface Segregation Principle (ISP)

**Repository Interfaces**:
- Each repository interface contains only methods needed by that entity
- `AccountRepository` has account-specific methods
- `PlantRepository` has plant-specific methods
- No fat interfaces with unused methods

**Service Interfaces**:
- Services expose only necessary methods
- Clients depend only on what they use

### 5. Dependency Inversion Principle (DIP)

**Service Dependencies**:
- Services depend on repository interfaces, not implementations
- `PlantService` depends on `PlantRepository` interface
- Infrastructure implements interfaces, not the other way around

**Dependency Injection**:
- All dependencies injected via constructor
- No service locator or static dependencies
- Enables easy testing with mocks

## Design Patterns

### 1. Repository Pattern

**Purpose**: Abstract data access layer

**Implementation**:
```typescript
// Domain layer defines interface
interface PlantRepository {
  findById(id: number): Promise<Plant | null>
  create(input: CreatePlantInput): Promise<Plant>
  // ...
}

// Infrastructure implements interface
class DynamoDBPlantRepository implements PlantRepository {
  // DynamoDB-specific implementation
}

// Service depends on interface
class PlantService {
  constructor(private plantRepository: PlantRepository) {}
}
```

**Benefits**:
- Decouples business logic from data access
- Easy to test (mock repositories)
- Can swap implementations (DynamoDB → PostgreSQL)

### 2. Factory Pattern

**Purpose**: Create vendor adapters dynamically

**Implementation**:
```typescript
class VendorManager {
  private static adapters: Map<string, AdapterClass> = new Map()
  
  static registerAdapter(vendorType: string, AdapterClass: new (config: VendorConfig) => BaseVendorAdapter): void {
    this.adapters.set(vendorType.toUpperCase(), AdapterClass)
  }
  
  static getAdapter(config: VendorConfig): BaseVendorAdapter {
    const AdapterClass = this.adapters.get(config.vendorType.toUpperCase())
    if (!AdapterClass) {
      throw new Error(`No adapter for ${config.vendorType}`)
    }
    return new AdapterClass(config)
  }
}
```

**Benefits**:
- Centralized adapter creation
- Easy to add new vendor types
- Type-safe adapter selection

### 3. Strategy Pattern

**Purpose**: Interchangeable vendor API implementations

**Implementation**:
```typescript
abstract class BaseVendorAdapter {
  abstract authenticate(): Promise<string>
  abstract listPlants(): Promise<Plant[]>
  abstract getTelemetry(plantId: string, start: Date, end: Date): Promise<TelemetryData[]>
  abstract getAlerts(plantId: string): Promise<Alert[]>
}

class SolarmanAdapter extends BaseVendorAdapter {
  // Solarman-specific implementation
}

class SolarDmAdapter extends BaseVendorAdapter {
  // SolarDM-specific implementation
}
```

**Benefits**:
- Each vendor has its own strategy
- Can swap strategies at runtime
- Easy to add new vendor strategies

### 4. Service Layer Pattern

**Purpose**: Encapsulate business logic

**Implementation**:
```typescript
class PlantService {
  constructor(
    private plantRepository: PlantRepository,
    private organizationRepository: OrganizationRepository,
    private vendorRepository: VendorRepository
  ) {}
  
  async createPlant(input: CreatePlantInput): Promise<Plant> {
    // Business logic: validation, orchestration
    // Delegates to repositories
  }
}
```

**Benefits**:
- Centralized business logic
- Reusable across different interfaces (API, CLI, events)
- Easy to test

### 5. Dependency Injection Pattern

**Purpose**: Invert dependencies, enable testing

**Implementation**:
```typescript
// Lambda handler
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))
const plantRepository = new DynamoDBPlantRepository(dynamoClient)
const orgRepository = new DynamoDBOrganizationRepository(dynamoClient)
const vendorRepository = new DynamoDBVendorRepository(dynamoClient)
const plantService = new PlantService(plantRepository, orgRepository, vendorRepository)

export async function getPlantsHandler(event: APIGatewayProxyEvent) {
  // Use plantService
}
```

**Benefits**:
- Explicit dependencies
- Easy to mock for testing
- Flexible configuration

### 6. Command Pattern (for API Handlers)

**Purpose**: Encapsulate requests as objects

**Implementation**:
- Each API handler is a command
- Handlers are stateless
- Can be easily tested in isolation

### 7. Builder Pattern (for Complex Objects)

**Purpose**: Construct complex objects step by step

**Use Cases**:
- Building DynamoDB query expressions
- Constructing vendor API requests
- Building aggregation results

### 8. Specification Pattern (for Complex Queries)

**Purpose**: Encapsulate business rules for queries

**Implementation**:
```typescript
interface PlantSpecification {
  isSatisfiedBy(plant: Plant): boolean
}

class ActivePlantSpecification implements PlantSpecification {
  isSatisfiedBy(plant: Plant): boolean {
    return plant.isActive === true
  }
}

class OrgPlantSpecification implements PlantSpecification {
  constructor(private orgId: number) {}
  
  isSatisfiedBy(plant: Plant): boolean {
    return plant.orgId === this.orgId
  }
}
```

**Benefits**:
- Reusable query logic
- Composable specifications
- Testable in isolation

### 9. Unit of Work Pattern (Not Applicable)

**Why Not**: DynamoDB transactions are limited (25 items max)
- Use batch operations instead
- Each operation is independent
- Eventual consistency is acceptable

### 10. Observer Pattern (Event-Driven)

**Purpose**: Decouple event producers and consumers

**Implementation**:
- EventBridge triggers Lambda functions
- Lambda functions are observers
- Producers (sync services) emit events
- Consumers (analytics, notifications) react to events

## Testing Patterns

### 1. Test Doubles (Mocks, Stubs, Fakes)

**Mocks**: Verify interactions
```typescript
const mockRepository = {
  findById: jest.fn().mockResolvedValue(mockPlant),
  create: jest.fn()
}
```

**Stubs**: Provide canned responses
```typescript
const stubRepository = {
  findById: () => Promise.resolve(mockPlant)
}
```

**Fakes**: Working implementations for testing
```typescript
class InMemoryPlantRepository implements PlantRepository {
  private plants: Map<number, Plant> = new Map()
  // In-memory implementation
}
```

### 2. Test Data Builders

**Purpose**: Create test objects easily

```typescript
class PlantBuilder {
  private plant: Partial<Plant> = {}
  
  withId(id: number): PlantBuilder {
    this.plant.id = id
    return this
  }
  
  withOrgId(orgId: number): PlantBuilder {
    this.plant.orgId = orgId
    return this
  }
  
  build(): Plant {
    return { ...defaultPlant, ...this.plant } as Plant
  }
}
```

### 3. Arrange-Act-Assert (AAA)

**Structure**:
```typescript
describe('PlantService', () => {
  it('should create plant', async () => {
    // Arrange
    const mockRepository = createMockRepository()
    const service = new PlantService(mockRepository)
    
    // Act
    const result = await service.createPlant(input)
    
    // Assert
    expect(result).toBeDefined()
    expect(mockRepository.create).toHaveBeenCalled()
  })
})
```

## Error Handling Patterns

### 1. Custom Error Classes

```typescript
class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} not found`)
    this.name = 'NotFoundError'
  }
}
```

### 2. Result Pattern (Optional)

For operations that can fail:
```typescript
type Result<T, E> = 
  | { success: true; data: T }
  | { success: false; error: E }
```

## Validation Patterns

### 1. Input Validation in Services

```typescript
async createPlant(input: CreatePlantInput): Promise<Plant> {
  if (!input.name) {
    throw new ValidationError('Name is required')
  }
  // Business validation
}
```

### 2. Schema Validation (Zod)

```typescript
import { z } from 'zod'

const CreatePlantSchema = z.object({
  name: z.string().min(1),
  capacityKw: z.number().positive(),
  orgId: z.number().int().positive(),
})

// Validate in API handler
const validated = CreatePlantSchema.parse(requestBody)
```

## Architecture Layers

```
┌─────────────────────────────────────┐
│   Interface Layer (API Handlers)    │  ← HTTP concerns, validation
├─────────────────────────────────────┤
│   Application Layer (Services)      │  ← Business logic, orchestration
├─────────────────────────────────────┤
│   Domain Layer (Entities)           │  ← Business rules, validation
├─────────────────────────────────────┤
│   Infrastructure Layer              │  ← Data access, external APIs
│   - Repositories                    │
│   - Vendor Adapters                 │
└─────────────────────────────────────┘
```

**Dependency Flow**: Interface → Application → Domain ← Infrastructure

## Best Practices

1. **Always depend on abstractions** (interfaces), not concretions
2. **Inject dependencies** via constructor
3. **Keep domain models pure** (no infrastructure dependencies)
4. **Use factories** for complex object creation
5. **Apply specifications** for complex business rules
6. **Test in isolation** using mocks/stubs
7. **Validate at boundaries** (API handlers, service methods)
8. **Handle errors explicitly** with custom error types
9. **Use composition** over inheritance where possible
10. **Keep functions small** and focused (SRP)

