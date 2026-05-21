import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Check whether a prediction market venue is allowed for a given US state code.
 * Fails open — if the DB query errors out or state is unknown, returns true.
 *
 * @param supabase  Authenticated Supabase client
 * @param venue     Venue key, e.g. 'polymarket' or 'kalshi'
 * @param stateCode 2-letter US state code, e.g. 'MN'
 */
export async function isVenueAllowedInState(
  supabase: SupabaseClient,
  venue: string,
  stateCode: string,
): Promise<boolean> {
  if (!stateCode) return true
  try {
    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('prediction_market_state_bans')
      .select('effective')
      .eq('state_code', stateCode.toUpperCase())
      .eq('venue', venue)
      .lte('effective', today)
      .limit(1)
      .maybeSingle()

    if (error) return true     // fail open on DB error
    return data === null       // null = no ban row → allowed
  } catch {
    return true                // fail open on network/unexpected error
  }
}

/**
 * Fetch the user's state_of_residence from the profiles table.
 * Returns null if unauthenticated, unset, or on error.
 */
export async function getUserStateOfResidence(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('state_of_residence')
      .eq('id', userId)
      .single()

    if (error || !data) return null
    return (data.state_of_residence as string | null) ?? null
  } catch {
    return null
  }
}
