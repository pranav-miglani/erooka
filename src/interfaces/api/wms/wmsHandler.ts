/**
 * WMS API Handlers
 * 
 * Handles WMS CRUD operations.
 * Based on WOMS WMS API implementation.
 */

import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda"
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import { DynamoDBWMSVendorRepository } from "../../../infrastructure/dynamodb/repositories/WMSVendorRepository"
import { DynamoDBWMSSiteRepository } from "../../../infrastructure/dynamodb/repositories/WMSSiteRepository"
import { DynamoDBWMSDeviceRepository } from "../../../infrastructure/dynamodb/repositories/WMSDeviceRepository"
import { DynamoDBInsolationReadingRepository } from "../../../infrastructure/dynamodb/repositories/InsolationReadingRepository"
import { DynamoDBOrganizationRepository } from "../../../infrastructure/dynamodb/repositories/OrganizationRepository"
import { WMSService } from "../../../application/wms/WMSService"
import { requirePermission } from "../../../shared/rbac/rbac"
import { AuthenticationError, AuthorizationError, ValidationError, NotFoundError } from "../../../shared/errors"

// Initialize DynamoDB client (reuse across invocations)
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}))

// Initialize repositories
const wmsVendorRepository = new DynamoDBWMSVendorRepository(dynamoClient)
const wmsSiteRepository = new DynamoDBWMSSiteRepository(dynamoClient)
const wmsDeviceRepository = new DynamoDBWMSDeviceRepository(dynamoClient)
const insolationReadingRepository = new DynamoDBInsolationReadingRepository(dynamoClient)
const organizationRepository = new DynamoDBOrganizationRepository(dynamoClient)

// Initialize service
const wmsService = new WMSService(
  wmsVendorRepository,
  wmsSiteRepository,
  wmsDeviceRepository,
  insolationReadingRepository,
  organizationRepository
)

/**
 * Parse session from cookie
 */
function parseSession(event: APIGatewayProxyEvent): {
  accountType: string
  accountId: string
  orgId?: number
} | null {
  const cookies = event.headers.cookie || event.headers.Cookie || ""
  const sessionCookie = cookies
    .split(";")
    .find((c) => c.trim().startsWith("session="))

  if (!sessionCookie) {
    return null
  }

  try {
    const sessionValue = sessionCookie.split("=")[1]
    const sessionData = JSON.parse(Buffer.from(sessionValue, "base64").toString())
    return sessionData
  } catch {
    return null
  }
}

/**
 * GET /api/wms-vendors
 */
export async function getWMSVendorsHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const session = parseSession(event)
    if (!session) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    try {
      requirePermission(session.accountType as any, "wms_vendors", "read")
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        }
      }
      throw error
    }

    const orgIdParam = event.queryStringParameters?.orgId
    const targetOrgId = orgIdParam ? parseInt(orgIdParam, 10) : undefined

    let vendors: any[] = []

    if (targetOrgId) {
      vendors = await wmsService.listWMSVendors(targetOrgId)
    } else if (session.accountType === "ORG" && session.orgId) {
      vendors = await wmsService.listWMSVendors(session.orgId)
    } else {
      vendors = await wmsService.listWMSVendors()
    }

    // Enrich with organization data
    const enrichedVendors = await Promise.all(
      vendors.map(async (v) => {
        const org = await organizationRepository.findById(v.orgId)
        return {
          ...v,
          organizations: org
            ? {
                id: org.id,
                name: org.name,
              }
            : null,
        }
      })
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendors: enrichedVendors }),
    }
  } catch (error: any) {
    console.error("WMS vendors API error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * POST /api/wms-vendors
 */
export async function createWMSVendorHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const session = parseSession(event)
    if (!session) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    try {
      requirePermission(session.accountType as any, "wms_vendors", "create")
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        }
      }
      throw error
    }

    const body = JSON.parse(event.body || "{}")
    const { name, vendor_type, credentials, org_id, is_active } = body

    if (!name || !vendor_type || !credentials || !org_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Missing required fields: name, vendor_type, credentials, org_id",
        }),
      }
    }

    const vendor = await wmsService.createWMSVendor({
      name,
      vendorType: vendor_type,
      credentials,
      orgId: org_id,
      isActive: is_active ?? true,
    })

    return {
      statusCode: 201,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vendor }),
    }
  } catch (error: any) {
    if (error instanceof ValidationError) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    if (error instanceof NotFoundError) {
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      }
    }

    console.error("Create WMS vendor error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * GET /api/wms-sites
 */
export async function getWMSSitesHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const session = parseSession(event)
    if (!session) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    try {
      requirePermission(session.accountType as any, "wms_vendors", "read")
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        }
      }
      throw error
    }

    const vendorIdParam = event.queryStringParameters?.vendorId
    const orgIdParam = event.queryStringParameters?.orgId

    const vendorId = vendorIdParam ? parseInt(vendorIdParam, 10) : undefined
    const orgId = orgIdParam ? parseInt(orgIdParam, 10) : undefined

    let sites: any[] = []

    if (vendorId) {
      sites = await wmsService.listWMSSites(vendorId)
    } else if (orgId) {
      sites = await wmsService.listWMSSites(undefined, orgId)
    } else if (session.accountType === "ORG" && session.orgId) {
      sites = await wmsService.listWMSSites(undefined, session.orgId)
    }

    // Enrich with vendor and organization data, and device count
    const enrichedSites = await Promise.all(
      sites.map(async (s) => {
        const vendor = await wmsVendorRepository.findById(s.wmsVendorId)
        const org = await organizationRepository.findById(s.orgId)
        const devices = await wmsDeviceRepository.findBySiteId(s.id)

        return {
          ...s,
          wms_vendors: vendor
            ? {
                id: vendor.id,
                name: vendor.name,
                vendor_type: vendor.vendorType,
              }
            : null,
          organizations: org
            ? {
                id: org.id,
                name: org.name,
              }
            : null,
          device_count: devices.length,
        }
      })
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sites: enrichedSites,
        count: enrichedSites.length,
      }),
    }
  } catch (error: any) {
    console.error("WMS sites API error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * GET /api/wms-devices
 */
export async function getWMSDevicesHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const session = parseSession(event)
    if (!session) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    try {
      requirePermission(session.accountType as any, "wms_vendors", "read")
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        }
      }
      throw error
    }

    const siteIdParam = event.queryStringParameters?.siteId
    const vendorIdParam = event.queryStringParameters?.vendorId

    const siteId = siteIdParam ? parseInt(siteIdParam, 10) : undefined
    const vendorId = vendorIdParam ? parseInt(vendorIdParam, 10) : undefined

    let devices: any[] = []

    if (siteId) {
      devices = await wmsService.listWMSDevices(siteId)
    } else if (vendorId) {
      devices = await wmsService.listWMSDevices(undefined, vendorId)
    }

    // Enrich with site, vendor, and organization data
    const enrichedDevices = await Promise.all(
      devices.map(async (d) => {
        const site = await wmsSiteRepository.findById(d.wmsSiteId)
        const vendor = site ? await wmsVendorRepository.findById(site.wmsVendorId) : null
        const org = site ? await organizationRepository.findById(site.orgId) : null

        return {
          ...d,
          wms_sites: site
            ? {
                id: site.id,
                site_name: site.siteName,
                vendor_site_id: site.vendorSiteId,
                org_id: site.orgId,
                wms_vendor_id: site.wmsVendorId,
                wms_vendors: vendor
                  ? {
                      id: vendor.id,
                      name: vendor.name,
                      vendor_type: vendor.vendorType,
                    }
                  : null,
                organizations: org
                  ? {
                      id: org.id,
                      name: org.name,
                    }
                  : null,
              }
            : null,
        }
      })
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        devices: enrichedDevices,
        count: enrichedDevices.length,
      }),
    }
  } catch (error: any) {
    console.error("WMS devices API error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

/**
 * GET /api/insolation-readings
 */
export async function getInsolationReadingsHandler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  try {
    const session = parseSession(event)
    if (!session) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized" }),
      }
    }

    try {
      requirePermission(session.accountType as any, "wms_vendors", "read")
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden" }),
        }
      }
      throw error
    }

    const deviceIdParam = event.queryStringParameters?.deviceId
    const startDateParam = event.queryStringParameters?.startDate
    const endDateParam = event.queryStringParameters?.endDate
    const limitParam = event.queryStringParameters?.limit

    const deviceId = deviceIdParam ? parseInt(deviceIdParam, 10) : undefined
    const startDate = startDateParam ? new Date(startDateParam) : undefined
    const endDate = endDateParam ? new Date(endDateParam) : undefined
    const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 200) : 100

    let readings: any[] = []

    if (deviceId) {
      readings = await wmsService.listInsolationReadings(deviceId, startDate, endDate, limit)
    } else if (startDateParam) {
      readings = await wmsService.listInsolationReadings(undefined, new Date(startDateParam))
    }

    // Enrich with device, site, vendor, and organization data
    const enrichedReadings = await Promise.all(
      readings.map(async (r) => {
        const device = await wmsDeviceRepository.findById(r.wmsDeviceId)
        const site = device ? await wmsSiteRepository.findById(device.wmsSiteId) : null
        const vendor = site ? await wmsVendorRepository.findById(site.wmsVendorId) : null
        const org = site ? await organizationRepository.findById(site.orgId) : null

        return {
          ...r,
          wms_devices: device
            ? {
                id: device.id,
                device_name: device.deviceName,
                vendor_device_id: device.vendorDeviceId,
                wms_sites: site
                  ? {
                      id: site.id,
                      site_name: site.siteName,
                      vendor_site_id: site.vendorSiteId,
                      org_id: site.orgId,
                      wms_vendor_id: site.wmsVendorId,
                      wms_vendors: vendor
                        ? {
                            id: vendor.id,
                            name: vendor.name,
                            vendor_type: vendor.vendorType,
                          }
                        : null,
                      organizations: org
                        ? {
                            id: org.id,
                            name: org.name,
                          }
                        : null,
                    }
                  : null,
              }
            : null,
        }
      })
    )

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        readings: enrichedReadings,
        count: enrichedReadings.length,
      }),
    }
  } catch (error: any) {
    console.error("Insolation readings API error:", error)
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Internal server error" }),
    }
  }
}

