# DynamoDB Write Optimization Analysis

## Critical Update: High-Frequency Plant Writes

### Actual Write Volume Analysis

**Plant Update Frequency**:
- **Interval**: Every 15 minutes
- **Working Window**: 5 AM to 8 PM (15 hours = 60 intervals/day)
- **Plants**: 7,000 plants
- **Writes per interval**: 7,000 plants
- **Daily writes**: 7,000 × 60 = **420,000 writes/day**
- **Monthly writes**: 420,000 × 30 = **12.6M writes/month**

**Attributes Updated** (6 attributes):
- `current_power_kw`
- `daily_energy_kwh`
- `total_energy_mwh`
- `monthly_energy_mwh`
- `yearly_energy_mwh`
- `is_online` (was_online_today)

### Cost Analysis (Updated)

**DynamoDB Free Tier**:
- **Storage**: 25 GB (permanently free)
- **Read Capacity**: 25 RCU = 25 reads/second = 2.16M reads/day = **64.8M reads/month** (free)
- **Write Capacity**: 25 WCU = 25 writes/second = 2.16M writes/day = **64.8M writes/month** (free)

**Our Usage**:
- **Plant writes**: 12.6M writes/month ✅ (within free tier)
- **Alert writes**: ~1.1M writes/month ✅ (within free tier)
- **Config writes**: ~100K writes/month ✅ (within free tier)
- **Total**: ~13.8M writes/month ✅ (well within 64.8M free tier)

**Cost**: Still **$0-5/month** (within free tier)

---

## Hot Partition Risk Analysis

### Problem: 7,000 Plants Updating Every 15 Minutes

**Risk**: If all plants are in the same partition, we could hit throttling limits.

**Solution**: Use **composite partition key** to distribute writes across partitions.

### Recommended Partition Key Strategy

#### Option 1: Plant ID as Partition Key (RECOMMENDED)
```
PK: PLANT#plant_id
SK: PLANT#plant_id
```

**Pros**:
- ✅ Each plant in its own partition (7K partitions = excellent distribution)
- ✅ No hot partitions
- ✅ Direct lookup by plant_id (O(1))
- ✅ Perfect for 7K plants

**Cons**:
- ❌ Need GSIs for org_id and vendor_id queries (but we have those)

**Verdict**: ✅ **BEST OPTION** - Perfect distribution, no hot partitions

#### Option 2: Org ID as Partition Key
```
PK: ORG#org_id
SK: PLANT#plant_id
```

**Pros**:
- ✅ Natural grouping by organization
- ✅ Efficient org queries (no GSI needed)

**Cons**:
- ❌ **HOT PARTITION RISK** - If one org has 5K plants, all writes hit one partition
- ❌ Throttling risk during sync windows

**Verdict**: ❌ **NOT RECOMMENDED** - Hot partition risk

#### Option 3: Vendor ID as Partition Key
```
PK: VENDOR#vendor_id
SK: PLANT#plant_id
```

**Pros**:
- ✅ Natural grouping by vendor
- ✅ Efficient vendor queries

**Cons**:
- ❌ **HOT PARTITION RISK** - If one vendor has 5K plants, all writes hit one partition
- ❌ Throttling risk

**Verdict**: ❌ **NOT RECOMMENDED** - Hot partition risk

---

## Write Optimization Strategies

### Strategy 1: Batch Writes (RECOMMENDED)

**DynamoDB BatchWriteItem**:
- **Limit**: 25 items per batch
- **7,000 plants**: 280 batches (7,000 ÷ 25)
- **Parallel execution**: Process batches in parallel (e.g., 10 concurrent batches)
- **Time**: ~28 batches sequentially = ~2-3 seconds for all plants

**Implementation**:
```typescript
// Pseudo-code
const batches = chunk(plants, 25); // 280 batches
const parallelBatches = 10; // Process 10 batches concurrently

for (let i = 0; i < batches.length; i += parallelBatches) {
  const batchGroup = batches.slice(i, i + parallelBatches);
  await Promise.all(
    batchGroup.map(batch => 
      dynamoDB.batchWriteItem({
        RequestItems: {
          'plants': batch.map(plant => ({
            PutRequest: { Item: plant }
          }))
        }
      })
    )
  );
}
```

**Benefits**:
- ✅ **Reduced API calls**: 280 calls instead of 7,000
- ✅ **Lower cost**: Batch writes are more efficient
- ✅ **Faster**: Parallel processing
- ✅ **No throttling**: Good partition distribution

### Strategy 2: UpdateItem with SET (Alternative)

**For individual updates**:
```typescript
await dynamoDB.updateItem({
  TableName: 'plants',
  Key: { PK: 'PLANT#123', SK: 'PLANT#123' },
  UpdateExpression: 'SET current_power_kw = :power, daily_energy_kwh = :daily, total_energy_mwh = :total, monthly_energy_mwh = :monthly, yearly_energy_mwh = :yearly, is_online = :online, updated_at = :now',
  ExpressionAttributeValues: {
    ':power': 125.5,
    ':daily': 2500.0,
    ':total': 10000.0,
    ':monthly': 750.0,
    ':yearly': 9000.0,
    ':online': true,
    ':now': new Date().toISOString()
  }
});
```

**Pros**:
- ✅ Atomic updates
- ✅ Only updates changed attributes

**Cons**:
- ❌ 7,000 individual API calls (slower, more expensive)
- ❌ Higher latency

**Verdict**: Use **BatchWriteItem** for sync operations

---

## Updated Table Design: `plants`

**Data Hierarchy**: Work Order → Organization → Vendors → Plants
- Work Orders are assigned to Organizations (org_id required)
- Organizations have multiple Vendors (20-50 max per org)
- Each Vendor has multiple Plants
- Work Orders can contain Plants from multiple Vendors within the same Organization

### Partition Key Strategy (FINAL)

**Primary Key**:
- **PK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **SK**: `PLANT#plant_id` (STRING) - Same as PK

**Why**: 
- ✅ **Perfect distribution**: 7K partitions = no hot partitions
- ✅ **Direct lookup**: O(1) by plant_id
- ✅ **Optimal for high-frequency writes**: Each plant isolated

### Global Secondary Indexes (Updated)

#### GSI1: `org-index` (Query by Organization - MOST COMMON)
- **GSI1PK**: `ORG#org_id` (STRING) - e.g., `ORG#1`
- **GSI1SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Query all plants for an organization
- **Query Pattern**: `GSI1PK = ORG#1`
- **Write Impact**: ✅ Low (only written once per plant, not on every update)

#### GSI2: `vendor-index` (Query by Vendor)
- **GSI2PK**: `VENDOR#vendor_id` (STRING) - e.g., `VENDOR#5`
- **GSI2SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Query all plants for a vendor
- **Query Pattern**: `GSI2PK = VENDOR#5`
- **Write Impact**: ✅ Low (only written once per plant)

#### GSI3: `vendor-plant-unique-index` (Unique Constraint)
- **GSI3PK**: `VENDOR#vendor_id#PLANT#vendor_plant_id` (STRING) - e.g., `VENDOR#5#PLANT#STATION123`
- **GSI3SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Enforce unique constraint (vendor_id, vendor_plant_id)
- **Query Pattern**: `GSI3PK = VENDOR#5#PLANT#STATION123`
- **Write Impact**: ✅ Low (only written once per plant)

#### GSI4: `status-index` (Query by Network Status - Optional)
- **GSI4PK**: `STATUS#network_status` (STRING) - e.g., `STATUS#NORMAL`
- **GSI4SK**: `PLANT#plant_id` (STRING) - e.g., `PLANT#123`
- **Purpose**: Query plants by network status
- **Query Pattern**: `GSI4PK = STATUS#NORMAL`
- **Write Impact**: ⚠️ Medium (updated on every sync if status changes)

**Note**: GSI4 is optional. If network_status rarely changes, we can query by filter expression instead of maintaining a GSI.

### Item Structure (Optimized for Writes)

```json
{
  "PK": "PLANT#123",
  "SK": "PLANT#123",
  "GSI1PK": "ORG#1",
  "GSI1SK": "PLANT#123",
  "GSI2PK": "VENDOR#5",
  "GSI2SK": "PLANT#123",
  "GSI3PK": "VENDOR#5#PLANT#STATION123",
  "GSI3SK": "PLANT#123",
  
  // Static attributes (written once)
  "org_id": 1,
  "vendor_id": 5,
  "vendor_plant_id": "STATION123",
  "name": "Solar Farm Alpha",
  "capacity_kw": 1000.0,
  "location": { "lat": 28.6139, "lng": 77.2090, "address": "Delhi, India" },
  
  // Dynamic attributes (updated every 15 minutes)
  "current_power_kw": 125.5,
  "daily_energy_kwh": 2500.0,
  "total_energy_mwh": 10000.0,
  "monthly_energy_mwh": 750.0,
  "yearly_energy_mwh": 9000.0,
  "is_online": true,
  "network_status": "NORMAL",
  "last_update_time": "2025-01-15T10:00:00Z",
  
  // Metadata
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

---

## TTL Update: 6 Months (180 Days)

### Alerts Table TTL

**Previous**: 365 days (1 year)  
**Updated**: **180 days (6 months)**

**Calculation**:
- **Alerts per day**: 35,000
- **Alerts per month**: 1,050,000
- **Alerts per 6 months**: 6,300,000 alerts
- **Storage**: 6.3M × 500 bytes = ~3.15 GB (within 25GB free tier)

**TTL Attribute**:
```typescript
ttl: Math.floor((new Date(alertTime).getTime() + 180 * 24 * 60 * 60 * 1000) / 1000)
```

### Insolation Readings TTL

**Current**: 100 days  
**Recommendation**: Keep at 100 days (WMS data, different retention policy)

---

## Vendor Volume Update

**Vendors**: 20-50 max (less than 100 total)

**Impact**:
- ✅ **Config table is perfect** - Low volume, simple access patterns
- ✅ No changes needed to vendor design
- ✅ GSI3 (vendor-token-index) still useful for token refresh

---

## Final Recommendations

### 1. Plant Table Partition Key
✅ **Use `PLANT#plant_id` as PK** - Perfect distribution, no hot partitions

### 2. Write Strategy
✅ **Use BatchWriteItem** - 280 batches, process 10-20 in parallel
- Reduces API calls from 7,000 to 280
- Faster execution (2-3 seconds vs 10-15 seconds)
- Lower cost

### 3. GSI Optimization
✅ **Keep GSI1, GSI2, GSI3** (org, vendor, unique constraint)
⚠️ **GSI4 (status-index) is optional** - Only if network_status queries are frequent

### 4. TTL Updates
✅ **Alerts**: 180 days (6 months)
✅ **Insolation**: 100 days (unchanged)

### 5. Cost Optimization
✅ **On-demand billing** - Pay per request (no capacity planning)
✅ **Within free tier** - 12.6M writes/month << 64.8M free tier
✅ **Estimated cost**: $0-5/month

---

## Implementation Notes

### Sync Service Pattern

```typescript
async function syncAllPlants() {
  // 1. Fetch all active plants (7K)
  const plants = await getActivePlants();
  
  // 2. Fetch latest data from vendor APIs (parallel)
  const plantData = await Promise.all(
    plants.map(plant => fetchPlantDataFromVendor(plant))
  );
  
  // 3. Prepare batch writes (280 batches of 25)
  const batches = chunk(plantData, 25);
  
  // 4. Process batches in parallel (10-20 concurrent)
  const parallelBatches = 10;
  for (let i = 0; i < batches.length; i += parallelBatches) {
    const batchGroup = batches.slice(i, i + parallelBatches);
    await Promise.all(
      batchGroup.map(batch => batchWritePlants(batch))
    );
  }
}
```

### Performance Targets

- **Sync duration**: < 2 minutes (Lambda timeout)
- **Batch processing**: 10-20 concurrent batches
- **Total time**: ~30-60 seconds for 7K plants
- **Write throughput**: ~7,000 writes in 30-60 seconds = 117-233 writes/second
- **DynamoDB capacity**: 25 WCU = 25 writes/second (free tier)
  - **Note**: On-demand billing handles bursts automatically

---

## Summary

✅ **Design is optimal** for 7K plants updating every 15 minutes
✅ **No hot partitions** - Plant ID as PK provides perfect distribution
✅ **Cost-effective** - Within free tier, batch writes optimize costs
✅ **TTL updated** - 6 months for alerts
✅ **Vendor volume** - No changes needed (20-50 vendors is low volume)

**Final Architecture**: 5 tables, optimized for high-frequency writes, cost-effective, scalable.

