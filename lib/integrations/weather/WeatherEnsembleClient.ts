/**
 * Weather ensemble client using Open-Meteo (free, no API key required).
 * Fetches GFS 31-member ensemble, ECMWF IFS, and ICON forecasts.
 * Used by polymarket_kalshi_weather strategy.
 */

const OPEN_METEO_BASE = 'https://ensemble-api.open-meteo.com/v1/ensemble'
const OPEN_METEO_STANDARD = 'https://api.open-meteo.com/v1/forecast'

export interface EnsembleForecast {
  lat: number
  lon: number
  variable: 'temperature_2m_max' | 'precipitation_sum' | 'wind_speed_10m_max'
  targetDate: string  // YYYY-MM-DD
  members: number[]   // one value per ensemble member
  memberCount: number
  consensus: number   // mean of members
  stdDev: number
  /** Fraction of members hitting threshold */
  fractionAbove(threshold: number): number
  fractionBelow(threshold: number): number
}

export interface WeatherConsensus {
  gfs: EnsembleForecast | null
  ecmwf: EnsembleForecast | null
  icon: EnsembleForecast | null
  /** Agreement score 0-1: fraction of non-null models agreeing on threshold direction */
  agreementScore: number
  /** Best-estimate probability of exceeding threshold */
  fairProb: number
}

type OmVariable = 'temperature_2m_max' | 'precipitation_sum' | 'wind_speed_10m_max'
type OmModel = 'gfs_seamless' | 'ecmwf_ifs04' | 'icon_seamless'

async function fetchEnsemble(
  lat: number,
  lon: number,
  variable: OmVariable,
  model: OmModel,
  targetDate: string
): Promise<EnsembleForecast | null> {
  try {
    const params = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      daily: variable,
      models: model,
      start_date: targetDate,
      end_date: targetDate,
      timezone: 'UTC',
    })

    const res = await fetch(`${OPEN_METEO_BASE}?${params}`, {
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null

    const data = await res.json() as {
      daily?: Record<string, (number | null)[]>
    }

    const vals = data.daily?.[variable] ?? []
    const members = vals.filter((v): v is number => v !== null)
    if (members.length === 0) return null

    const consensus = members.reduce((s, v) => s + v, 0) / members.length
    const variance = members.reduce((s, v) => s + (v - consensus) ** 2, 0) / Math.max(members.length - 1, 1)
    const stdDev = Math.sqrt(variance)

    return {
      lat, lon, variable, targetDate, members,
      memberCount: members.length,
      consensus, stdDev,
      fractionAbove: (t: number) => members.filter(v => v >= t).length / members.length,
      fractionBelow: (t: number) => members.filter(v => v <= t).length / members.length,
    }
  } catch {
    return null
  }
}

/** Fetch GFS 31-member ensemble for a location and date. */
export async function getGfsEnsemble31(
  lat: number,
  lon: number,
  variable: OmVariable,
  targetDate: string
): Promise<EnsembleForecast | null> {
  return fetchEnsemble(lat, lon, variable, 'gfs_seamless', targetDate)
}

/** Fetch ECMWF IFS ensemble. */
export async function getEcmwf(
  lat: number,
  lon: number,
  variable: OmVariable,
  targetDate: string
): Promise<EnsembleForecast | null> {
  return fetchEnsemble(lat, lon, variable, 'ecmwf_ifs04', targetDate)
}

/** Fetch ICON ensemble. */
export async function getIcon(
  lat: number,
  lon: number,
  variable: OmVariable,
  targetDate: string
): Promise<EnsembleForecast | null> {
  return fetchEnsemble(lat, lon, variable, 'icon_seamless', targetDate)
}

/**
 * Fetch consensus from all three models and compute:
 *   fairProb = weighted mean of fractionAbove(threshold) across models
 *   agreementScore = fraction of models that agree on direction
 */
export async function getConsensus(
  lat: number,
  lon: number,
  variable: OmVariable,
  targetDate: string,
  threshold: number
): Promise<WeatherConsensus> {
  const [gfs, ecmwf, icon] = await Promise.all([
    getGfsEnsemble31(lat, lon, variable, targetDate),
    getEcmwf(lat, lon, variable, targetDate),
    getIcon(lat, lon, variable, targetDate),
  ])

  const models = [gfs, ecmwf, icon].filter((m): m is EnsembleForecast => m !== null)

  if (models.length === 0) {
    return { gfs, ecmwf, icon, agreementScore: 0, fairProb: 0.5 }
  }

  const probsAbove = models.map(m => m.fractionAbove(threshold))
  const fairProb = probsAbove.reduce((s, p) => s + p, 0) / probsAbove.length

  // Agreement: fraction of models that say the same direction (above or below 0.5)
  const allAbove = probsAbove.filter(p => p >= 0.5).length
  const majorityAbove = allAbove >= models.length / 2
  const agreeing = majorityAbove
    ? probsAbove.filter(p => p >= 0.5).length
    : probsAbove.filter(p => p < 0.5).length
  const agreementScore = agreeing / models.length

  return { gfs, ecmwf, icon, agreementScore, fairProb }
}
