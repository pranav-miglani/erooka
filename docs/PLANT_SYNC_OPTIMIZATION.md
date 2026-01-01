# Plant Sync Optimization Strategy

## Write Volume: 7,000 Plants Every 15 Minutes

### Requirements
- **Plants**: 7,000 plants
- **Update Frequency**: Every 15 minutes
- **Working Window**: 5 AM to 8 PM (15 hours = 60 intervals/day)
- **Attributes Updated**: 6 attributes (current_power_kw, daily_energy_kwh, total_energy_mwh, monthly_energy_mwh, yearly_energy_mwh, is_online)
- **Daily Writes**: 420,000 writes/day
- **Monthly Writes**: 12.6M writes/month

## Optimization Strategy

### 1. Batch Writes (CRITICAL)

**DynamoDB BatchWriteItem**:
- **Limit**: 25 items per batch
- **7,000 plants**: 280 batches
- **Parallel execution**: 10-20 concurrent batches
- **Time**: ~30-60 seconds for all plants

**Implementation**:
```typescript
// Pseudo-code for plant sync service
async function syncAllPlants() {
  const plants = await getActivePlants(); // 7K plants
  
  // Fetch data from vendor APIs (parallel)
  const plantData = await Promise.all(
    plants.map(plant => fetchPlantDataFromVendor(plant))
  );
  
  // Prepare batch writes
  const batches = chunk(plantData, 25); // 280 batches
  
  // Process in parallel (10-20 concurrent)
  const parallelBatches = 15;
  for (let i = 0; i < batches.length; i += parallelBatches) {
    const batchGroup = batches.slice(i, i + parallelBatches);
    await Promise.all(
      batchGroup.map(batch => 
        dynamoDB.batchWriteItem({
          RequestItems: {
            'plants': batch.map(plant => ({
              PutRequest: {
                Item: {
                  PK: `PLANT#${plant.id}`,
                  SK: `PLANT#${plant.id}`,
                  // ... all attributes including GSIs
                  current_power_kw: plant.current_power_kw,
                  daily_energy_kwh: plant.daily_energy_kwh,
                  total_energy_mwh: plant.total_energy_mwh,
                  monthly_energy_mwh: plant.monthly_energy_mwh,
                  yearly_energy_mwh: plant.yearly_energy_mwh,
                  is_online: plant.is_online,
                  updated_at: new Date().toISOString()
                }
              }
            }))
          }
        })
      )
    );
  }
}
```

### 2. Partition Key: Plant ID (OPTIMAL)

**Why Plant ID as PK**:
- ✅ **Perfect distribution**: 7K partitions = no hot partitions
- ✅ **No throttling**: Each plant isolated
- ✅ **Direct lookup**: O(1) by plant_id
- ✅ **Optimal for writes**: Each write goes to different partition

### 3. GSI Write Optimization

**GSI Updates**:
- GSIs are **automatically updated** by DynamoDB on PutItem
- **Cost**: GSI writes count as separate writes (but still within free tier)
- **Optimization**: GSIs only contain static data (org_id, vendor_id) - not updated every 15 minutes

**GSI Write Volume**:
- **GSI1 (org-index)**: Updated only when plant org changes (rare)
- **GSI2 (vendor-index)**: Updated only when plant vendor changes (rare)
- **GSI3 (vendor-plant-unique)**: Updated only when plant vendor changes (rare)
- **GSI4 (status-index)**: Optional - only if network_status changes frequently

**Total GSI writes**: ~0-100 per sync (only for new/changed plants)

### 4. Error Handling & Retries

**Unprocessed Items**:
```typescript
async function batchWriteWithRetry(batches: any[]) {
  const maxRetries = 3;
  
  for (const batch of batches) {
    let retries = 0;
    let unprocessedItems = batch;
    
    while (unprocessedItems && retries < maxRetries) {
      const result = await dynamoDB.batchWriteItem({
        RequestItems: {
          'plants': unprocessedItems
        }
      });
      
      if (result.UnprocessedItems && Object.keys(result.UnprocessedItems).length > 0) {
        unprocessedItems = result.UnprocessedItems['plants'];
        retries++;
        await sleep(1000 * retries); // Exponential backoff
      } else {
        break;
      }
    }
  }
}
```

### 5. Performance Targets

- **Sync duration**: < 2 minutes (Lambda timeout)
- **Batch processing**: 15 concurrent batches
- **Total time**: ~30-60 seconds for 7K plants
- **Write throughput**: ~7,000 writes in 30-60 seconds = 117-233 writes/second
- **DynamoDB capacity**: On-demand billing handles bursts automatically

### 6. Cost Optimization

**BatchWriteItem Benefits**:
- ✅ **Reduced API calls**: 280 calls instead of 7,000
- ✅ **Lower latency**: Parallel processing
- ✅ **Lower cost**: Batch operations are more efficient
- ✅ **No throttling**: Good partition distribution

**Monthly Cost**:
- **Writes**: 12.6M writes/month
- **Free tier**: 64.8M writes/month
- **Cost**: $0 (within free tier)

## Implementation Checklist

- [ ] Implement BatchWriteItem for plant sync
- [ ] Configure parallel batch processing (15 concurrent)
- [ ] Add retry logic for unprocessed items
- [ ] Monitor write throughput and latency
- [ ] Set up CloudWatch alarms for throttling
- [ ] Test with 7K plants in staging
- [ ] Optimize batch size if needed (25 is optimal)

## Monitoring

**Key Metrics**:
- Write throughput (writes/second)
- Throttling events
- Sync duration
- Unprocessed items count
- Error rate

**CloudWatch Alarms**:
- Throttling events > 0
- Sync duration > 90 seconds
- Error rate > 1%

