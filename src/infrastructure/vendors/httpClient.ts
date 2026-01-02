/**
 * Shared HTTP client with connection pooling for vendor API calls
 * Uses native fetch (Lambda environment doesn't support undici)
 * 
 * Based on WOMS httpClient implementation, simplified for Lambda.
 */

/**
 * Pooled fetch function (simplified for Lambda)
 * In Lambda, we rely on AWS's connection pooling
 * Falls back to native fetch
 */
export async function pooledFetch(
  url: string | URL,
  options?: RequestInit
): Promise<Response> {
  // In Lambda, use native fetch (AWS handles connection pooling)
  return fetch(url, options)
}

/**
 * Cleanup function (no-op in Lambda)
 * Useful for graceful shutdown in other environments
 */
export function closeAllConnections(): void {
  // No-op in Lambda environment
}

