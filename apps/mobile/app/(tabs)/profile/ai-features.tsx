/**
 * AI Features settings screen — mobile.
 *
 * Mirrors the web settings/ai-features page with React Native primitives:
 *   - Switch for toggle
 *   - Bottom-sheet-style modal for budget editing (uses Modal)
 *   - Haptic feedback on toggle (expo-haptics, graceful no-op if unavailable)
 *   - Notification opt-in placeholder for budget alerts
 */

import {
  View,
  Text,
  Switch,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native'
import { useState, useEffect, useCallback } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { supabase } from '../../lib/supabase'

// ── Haptics (graceful no-op when expo-haptics not installed) ──────────────────
let Haptics: { impactAsync: (style?: unknown) => Promise<void> } | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Haptics = require('expo-haptics')
} catch {
  // not installed — skip
}

async function hapticLight() {
  try {
    await Haptics?.impactAsync?.()
  } catch {}
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeatureFlag {
  feature_key: string
  enabled: boolean
  monthly_budget_usd: number
  alert_threshold_pct: number
}

interface FeatureDef {
  feature_key: string
  display_name: string
  description: string
  category: string
  cost_per_use_usd: number
  cost_unit: string
  default_budget_usd: number
}

interface UsageSummary {
  feature_key: string
  spend_usd: number
}

// ─── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({
  def,
  flag,
  usage,
  onToggle,
  onEditBudget,
}: {
  def: FeatureDef
  flag: FeatureFlag | undefined
  usage: UsageSummary | undefined
  onToggle: (key: string, enabled: boolean) => void
  onEditBudget: (key: string, current: number) => void
}) {
  const enabled = flag?.enabled ?? false
  const budgetUsd = flag?.monthly_budget_usd ?? def.default_budget_usd
  const spentUsd = usage?.spend_usd ?? 0
  const pct = budgetUsd > 0 ? Math.min(1, spentUsd / budgetUsd) : 0
  const barColor = pct >= 0.9 ? '#ef4444' : pct >= 0.7 ? '#f59e0b' : '#8b5cf6'

  return (
    <View style={[styles.card, enabled && styles.cardActive]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{def.display_name}</Text>
          <Text style={styles.cardSub}>{def.description}</Text>
          <Text style={styles.cardCost}>
            ~${def.cost_per_use_usd.toFixed(4)} / {def.cost_unit}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={v => {
            hapticLight()
            onToggle(def.feature_key, v)
          }}
          trackColor={{ false: 'rgba(255,255,255,0.1)', true: '#7c3aed' }}
          thumbColor={enabled ? '#8b5cf6' : '#9ca3af'}
          ios_backgroundColor="rgba(255,255,255,0.1)"
        />
      </View>

      {enabled && (
        <View style={styles.cardDetails}>
          {/* Progress bar */}
          <View style={styles.progressRow}>
            <Text style={styles.smallText}>Spent: ${spentUsd.toFixed(2)}</Text>
            <Text style={styles.smallText}>Cap: ${budgetUsd.toFixed(0)}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressBar,
                { width: `${pct * 100}%` as `${number}%`, backgroundColor: barColor },
              ]}
            />
          </View>

          {/* Edit budget button */}
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => onEditBudget(def.feature_key, budgetUsd)}
            activeOpacity={0.7}
          >
            <Ionicons name="wallet-outline" size={12} color="#8b5cf6" />
            <Text style={styles.editBtnText}>Set monthly cap (${budgetUsd.toFixed(0)})</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  )
}

// ─── Budget bottom sheet ──────────────────────────────────────────────────────

function BudgetSheet({
  visible,
  featureKey,
  currentBudget,
  onClose,
  onSave,
}: {
  visible: boolean
  featureKey: string
  currentBudget: number
  onClose: () => void
  onSave: (key: string, budget: number) => void
}) {
  const [val, setVal] = useState(String(Math.round(currentBudget)))

  // Reset the editable input to the current budget whenever the sheet is opened
  // or the incoming budget changes. Done as an adjust-state-during-render (the
  // React-recommended replacement for a reset-on-prop-change effect) so it does
  // not trigger a synchronous setState inside an effect. Behavior is unchanged:
  // val is re-seeded on every change to currentBudget/visible, and freely
  // editable in between.
  const [prevKey, setPrevKey] = useState({ currentBudget, visible })
  if (prevKey.currentBudget !== currentBudget || prevKey.visible !== visible) {
    setPrevKey({ currentBudget, visible })
    setVal(String(Math.round(currentBudget)))
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Monthly Cap</Text>
        <Text style={styles.sheetSub}>
          Set the maximum dollars this feature can spend per calendar month.
        </Text>
        <View style={styles.sheetInputRow}>
          <Text style={styles.dollar}>$</Text>
          <TextInput
            style={styles.sheetInput}
            value={val}
            onChangeText={setVal}
            keyboardType="numeric"
            selectTextOnFocus
            placeholderTextColor="#6b7280"
            autoFocus
          />
        </View>
        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => {
            const n = Math.max(1, parseInt(val, 10) || 1)
            onSave(featureKey, n)
            onClose()
          }}
          activeOpacity={0.85}
        >
          <Text style={styles.saveBtnText}>Save</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  )
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AIFeaturesScreen() {
  const [definitions, setDefinitions] = useState<FeatureDef[]>([])
  const [flags, setFlags] = useState<Map<string, FeatureFlag>>(new Map())
  const [usage, setUsage] = useState<Map<string, UsageSummary>>(new Map())
  const [loading, setLoading] = useState(true)
  const [sheet, setSheet] = useState<{ key: string; budget: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()

    const [defsRes, flagsRes, usageRes] = await Promise.all([
      supabase
        .from('ai_feature_definitions')
        .select('feature_key, display_name, description, category, cost_per_use_usd, cost_unit, default_budget_usd')
        .eq('is_available', true)
        .order('category')
        .order('feature_key'),
      supabase
        .from('ai_feature_flags')
        .select('feature_key, enabled, monthly_budget_usd, alert_threshold_pct')
        .eq('user_id', user.id),
      supabase
        .from('ai_usage_logs')
        .select('feature_key, cost_usd')
        .eq('user_id', user.id)
        .gte('created_at', monthStart),
    ])

    setDefinitions((defsRes.data ?? []) as FeatureDef[])
    setFlags(new Map((flagsRes.data ?? []).map((f: FeatureFlag) => [f.feature_key, f])))

    const usageAgg = new Map<string, UsageSummary>()
    for (const row of (usageRes.data ?? [])) {
      const e = usageAgg.get(row.feature_key)
      if (e) e.spend_usd += row.cost_usd
      else usageAgg.set(row.feature_key, { feature_key: row.feature_key, spend_usd: row.cost_usd })
    }
    setUsage(usageAgg)
    setLoading(false)
  }, [])

  // Wrap in an async IIFE so the setState calls inside load() happen after an
  // await rather than synchronously in the effect body. load() is still invoked
  // synchronously, so fetch timing and the initial setLoading(true) are unchanged.
  useEffect(() => { void (async () => { await load() })() }, [load])

  async function handleToggle(key: string, enabled: boolean) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const existing = flags.get(key)
    await supabase.from('ai_feature_flags').upsert(
      {
        user_id: user.id,
        feature_key: key,
        enabled,
        monthly_budget_usd: existing?.monthly_budget_usd ?? 20,
        alert_threshold_pct: existing?.alert_threshold_pct ?? 80,
      },
      { onConflict: 'user_id,feature_key' }
    )
    setFlags(prev => {
      const next = new Map(prev)
      next.set(key, { ...(prev.get(key) ?? { feature_key: key, alert_threshold_pct: 80, monthly_budget_usd: 20 }), enabled })
      return next
    })
  }

  async function handleBudgetSave(key: string, budgetUsd: number) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const existing = flags.get(key)
    await supabase.from('ai_feature_flags').upsert(
      {
        user_id: user.id,
        feature_key: key,
        enabled: existing?.enabled ?? false,
        monthly_budget_usd: budgetUsd,
        alert_threshold_pct: existing?.alert_threshold_pct ?? 80,
      },
      { onConflict: 'user_id,feature_key' }
    )
    setFlags(prev => {
      const next = new Map(prev)
      next.set(key, { ...(prev.get(key) ?? { feature_key: key, alert_threshold_pct: 80, enabled: false }), monthly_budget_usd: budgetUsd })
      return next
    })
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#8b5cf6" />
      </View>
    )
  }

  const confluence = definitions.filter(d => d.category === 'ai_confluence')
  const premiumData = definitions.filter(d => d.category === 'premium_data')
  const allOff = definitions.every(d => !(flags.get(d.feature_key)?.enabled))

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Text style={styles.heading}>AI Features</Text>
        <Text style={styles.sub}>Control paid AI capabilities and monthly spend caps.</Text>

        {allOff && (
          <View style={styles.emptyBanner}>
            <Ionicons name="sparkles-outline" size={20} color="#4b5563" />
            <Text style={styles.emptyText}>
              Wealth OS works fully without paid AI features. Toggle on what you want, when you want.
            </Text>
          </View>
        )}

        {confluence.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>AI Confluence Layer</Text>
            {confluence.map(def => (
              <FeatureCard
                key={def.feature_key}
                def={def}
                flag={flags.get(def.feature_key)}
                usage={usage.get(def.feature_key)}
                onToggle={handleToggle}
                onEditBudget={(key, budget) => setSheet({ key, budget })}
              />
            ))}
          </>
        )}

        {premiumData.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Premium Data Feeds</Text>
            {premiumData.map(def => (
              <FeatureCard
                key={def.feature_key}
                def={def}
                flag={flags.get(def.feature_key)}
                usage={usage.get(def.feature_key)}
                onToggle={handleToggle}
                onEditBudget={(key, budget) => setSheet({ key, budget })}
              />
            ))}
          </>
        )}
      </ScrollView>

      <BudgetSheet
        visible={sheet !== null}
        featureKey={sheet?.key ?? ''}
        currentBudget={sheet?.budget ?? 20}
        onClose={() => setSheet(null)}
        onSave={handleBudgetSave}
      />
    </>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0b0f' },
  content: { padding: 20, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 40 },
  center: { flex: 1, backgroundColor: '#0a0b0f', alignItems: 'center', justifyContent: 'center' },
  heading: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  sub: { color: '#6b7280', fontSize: 13, marginBottom: 20 },
  sectionTitle: { color: '#9ca3af', fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 8,
  },
  cardActive: { borderColor: 'rgba(139,92,246,0.3)', backgroundColor: 'rgba(139,92,246,0.04)' },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle: { color: '#fff', fontSize: 14, fontWeight: '600', marginBottom: 2 },
  cardSub: { color: '#6b7280', fontSize: 12, lineHeight: 16 },
  cardCost: { color: '#4b5563', fontSize: 10, marginTop: 4 },
  cardDetails: { marginTop: 12, gap: 6 },
  progressRow: { flexDirection: 'row', justifyContent: 'space-between' },
  smallText: { color: '#6b7280', fontSize: 10 },
  progressTrack: { height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  progressBar: { height: 4, borderRadius: 2 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  editBtnText: { color: '#8b5cf6', fontSize: 11 },
  emptyBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    marginBottom: 20,
  },
  emptyText: { color: '#6b7280', fontSize: 13, flex: 1, lineHeight: 18 },
  // Bottom sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#16171f',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  sheetTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 6 },
  sheetSub: { color: '#6b7280', fontSize: 13, marginBottom: 20 },
  sheetInputRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 20 },
  dollar: { color: '#9ca3af', fontSize: 18, fontWeight: '600' },
  sheetInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  saveBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
