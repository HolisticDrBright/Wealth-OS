import { useState } from 'react'
import { View, Text, TextInput, KeyboardAvoidingView, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { supabase } from '@/lib/supabase'
import { Card, PrimaryButton } from '@/src/ui'
import { colors } from '@/src/theme'

export default function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    if (!email || !password) return
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.replace('/(tabs)')
    }
  }

  const inputClass = 'min-h-[48px] rounded-btn border border-stroke bg-inset px-4 font-inter text-[15px] text-ink'

  return (
    <SafeAreaView className="flex-1 bg-ground">
      <KeyboardAvoidingView className="flex-1 justify-center px-screen" behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Card className="gap-3 p-6">
          <Text accessibilityRole="header" className="text-center font-inter-bold text-[24px] text-ink">Wealth OS</Text>
          <Text className="mb-2 text-center font-inter text-[13px] text-ink-secondary">Your money, in plain English</Text>

          {error && (
            <Text accessibilityLiveRegion="polite" className="rounded-btn border border-loss bg-loss-bg p-3 font-inter text-[13px] text-loss">
              {error}
            </Text>
          )}

          <TextInput
            accessibilityLabel="Email"
            className={inputClass}
            placeholder="Email"
            placeholderTextColor={colors.inkMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            accessibilityLabel="Password"
            className={inputClass}
            placeholder="Password"
            placeholderTextColor={colors.inkMuted}
            secureTextEntry
            autoComplete="password"
            value={password}
            onChangeText={setPassword}
          />

          <View className="mt-2">
            <PrimaryButton title="Sign in" busy={loading} disabled={!email || !password} onPress={signIn} />
          </View>
        </Card>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
