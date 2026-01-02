/**
 * Vendor Manager - Factory pattern for creating vendor adapters
 * Dynamically selects the correct adapter based on vendor type
 * 
 * Based on WOMS VendorManager implementation.
 */

import { BaseVendorAdapter } from "./base/BaseVendorAdapter"
import type { VendorConfig } from "./types"

/**
 * Vendor Manager - Factory pattern for creating vendor adapters
 * Dynamically selects the correct adapter based on vendor type
 */
export class VendorManager {
  private static adapters: Map<string, new (config: VendorConfig) => BaseVendorAdapter> =
    new Map()

  /**
   * Register a new vendor adapter type
   */
  static registerAdapter(
    vendorType: string,
    adapterClass: new (config: VendorConfig) => BaseVendorAdapter
  ): void {
    this.adapters.set(vendorType.toUpperCase(), adapterClass)
  }

  /**
   * Get an adapter instance for a given vendor config
   */
  static getAdapter(config: VendorConfig): BaseVendorAdapter {
    const vendorType = config.vendorType.toUpperCase()
    const AdapterClass = this.adapters.get(vendorType)

    if (!AdapterClass) {
      throw new Error(
        `No adapter registered for vendor type: ${vendorType}. Available types: ${Array.from(
          this.adapters.keys()
        ).join(", ")}`
      )
    }

    return new AdapterClass(config)
  }

  /**
   * Check if a vendor type is supported
   */
  static isSupported(vendorType: string): boolean {
    return this.adapters.has(vendorType.toUpperCase())
  }

  /**
   * Get list of supported vendor types
   */
  static getSupportedTypes(): string[] {
    return Array.from(this.adapters.keys())
  }
}

// Note: Adapters will be registered here once implemented
// VendorManager.registerAdapter("SOLARMAN", SolarmanAdapter)
// VendorManager.registerAdapter("SOLARDM", SolarDmAdapter)
// VendorManager.registerAdapter("SHINEMONITOR", ShineMonitorAdapter)
// VendorManager.registerAdapter("PVBLINK", PvBlinkAdapter)
// VendorManager.registerAdapter("FOXESSCLOUD", FoxesscloudAdapter)

