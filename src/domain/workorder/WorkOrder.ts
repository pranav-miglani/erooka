/**
 * Work Order Domain Entity
 * 
 * Represents a work order for solar plants.
 * Based on WOMS work_orders table structure.
 * 
 * Work Orders belong to Organizations (org_id required).
 * Work Orders can optionally have a WMS Device assigned (wms_device_id).
 * Work Orders contain Plants from multiple Vendors (all within the same Organization).
 */

export interface WorkOrder {
  id: number
  title: string
  description: string | null
  orgId: number
  wmsDeviceId: number | null
  createdBy: string | null
  createdAt: Date
  updatedAt: Date
}

export interface CreateWorkOrderInput {
  title: string
  description?: string | null
  orgId: number
  plantIds: number[]
  wmsDeviceId?: number | null
  createdBy?: string | null
}

export interface UpdateWorkOrderInput {
  title?: string
  description?: string | null
  plantIds?: number[]
  wmsDeviceId?: number | null
}

export interface WorkOrderRepository {
  findById(id: number): Promise<WorkOrder | null>
  findByOrgId(orgId: number): Promise<WorkOrder[]>
  findAll(): Promise<WorkOrder[]>
  create(input: CreateWorkOrderInput): Promise<WorkOrder>
  update(id: number, updates: UpdateWorkOrderInput): Promise<WorkOrder>
  delete(id: number): Promise<void>
}

/**
 * Work Order Plant Mapping
 * 
 * Junction table for many-to-many relationship between Work Orders and Plants.
 * Stored in work-order-plants table.
 */
export interface WorkOrderPlant {
  workOrderId: number
  plantId: number
  isActive: boolean
  addedAt: Date
}

export interface WorkOrderPlantRepository {
  findByWorkOrderId(workOrderId: number): Promise<WorkOrderPlant[]>
  findByPlantId(plantId: number): Promise<WorkOrderPlant[]>
  findByWorkOrderIdAndActive(workOrderId: number, isActive: boolean): Promise<WorkOrderPlant[]>
  create(mapping: Omit<WorkOrderPlant, "addedAt">): Promise<WorkOrderPlant>
  update(workOrderId: number, plantId: number, updates: Partial<WorkOrderPlant>): Promise<WorkOrderPlant>
  delete(workOrderId: number, plantId: number): Promise<void>
  batchCreate(mappings: Omit<WorkOrderPlant, "addedAt">[]): Promise<void>
  batchUpdate(workOrderId: number, plantIds: number[], isActive: boolean): Promise<void>
}

