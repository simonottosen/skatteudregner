/**
 * Calculate driving distance between two addresses using:
 * - Nominatim (OpenStreetMap) for geocoding addresses → coordinates
 * - OSRM (project-osrm.org) for routing coordinates → distance
 *
 * All requests are made client-side. No API keys required.
 */

interface GeocodingResult {
  lat: number
  lon: number
  displayName: string
}

interface DistanceResult {
  /** One-way distance in km */
  oneWayKm: number
  /** Round-trip distance in km */
  roundTripKm: number
  /** Estimated one-way duration in minutes */
  durationMinutes: number
}

/**
 * Clean a Danish address for geocoding.
 * Strips floor/apartment info (e.g. "4.tv", "st. th.", "3. sal")
 * and city name — keeps only street, number, and postal code.
 */
function cleanAddressForGeocoding(address: string): string {
  return (
    address
      // Remove floor/apartment indicators: "4.tv", "st.th", "2. sal", "1. th", "4 tv", etc.
      .replace(/,?\s*\d*\.?\s*(?:tv|th|mf|st|sal|lejl|kld)\.?\b/gi, "")
      // Remove city name after postal code: "1669 København V" → "1669"
      .replace(/(\d{4})\s+[A-ZÆØÅa-zæøå][\wæøåÆØÅ\s]*$/, "$1")
      // Clean up leftover commas and whitespace
      .replace(/,\s*,/g, ",")
      .replace(/,\s*$/, "")
      .trim()
  )
}

/**
 * Geocode an address using Nominatim (OpenStreetMap).
 * Biased towards Denmark for better results.
 */
async function geocodeAddress(address: string): Promise<GeocodingResult> {
  const cleaned = cleanAddressForGeocoding(address)
  const query = encodeURIComponent(cleaned)
  const url = `https://nominatim.openstreetmap.org/search?q=${query}&format=json&countrycodes=dk&limit=1&addressdetails=0`

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Skatteudregner/1.0 (commute-deduction-calculator)",
    },
  })

  if (!res.ok) {
    throw new Error(`Geocoding fejlede: ${res.status}`)
  }

  const data = await res.json()
  if (!data || data.length === 0) {
    throw new Error(`Kunne ikke finde adressen: "${cleaned}"`)
  }

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
    displayName: data[0].display_name,
  }
}

/**
 * Get driving distance between two coordinates using OSRM.
 * Uses the car profile on the public demo server.
 */
async function getRouteDistance(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number }
): Promise<{ distanceMeters: number; durationSeconds: number }> {
  // OSRM expects lon,lat order
  const coords = `${from.lon},${from.lat};${to.lon},${to.lat}`
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=false`

  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Ruteplanlægning fejlede: ${res.status}`)
  }

  const data = await res.json()
  if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
    throw new Error("Kunne ikke finde en rute mellem adresserne")
  }

  return {
    distanceMeters: data.routes[0].distance,
    durationSeconds: data.routes[0].duration,
  }
}

/**
 * Calculate the driving distance between two Danish addresses.
 * Returns both one-way and round-trip distances.
 */
export async function calculateDrivingDistance(
  fromAddress: string,
  toAddress: string
): Promise<DistanceResult> {
  // Geocode both addresses (in parallel)
  const [from, to] = await Promise.all([
    geocodeAddress(fromAddress),
    geocodeAddress(toAddress),
  ])

  // Get driving route
  const route = await getRouteDistance(from, to)

  const oneWayKm = Math.round(route.distanceMeters / 1000)
  return {
    oneWayKm,
    roundTripKm: oneWayKm * 2,
    durationMinutes: Math.round(route.durationSeconds / 60),
  }
}
