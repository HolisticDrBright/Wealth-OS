import { RulesClient } from './rules-client'
import { getRules } from '@/lib/actions/autopilot-rules'

export default async function RulesPage() {
  const rules = await getRules()
  return <RulesClient initialRules={rules} />
}
