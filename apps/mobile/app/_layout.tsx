import '../global.css'

import { useEffect, useState } from 'react'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { View, ActivityIndicator } from 'react-native'
import { useFonts } from 'expo-font'
import {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
} from '@expo-google-fonts/inter'
import {
  JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
} from '@expo-google-fonts/jetbrains-mono'
import { supabase } from '@/lib/supabase'
import { colors } from '@/src/theme'
import type { Session } from '@supabase/supabase-js'

export default function RootLayout() {
  const [, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [fontsLoaded] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    JetBrainsMono_500Medium, JetBrainsMono_600SemiBold,
  })

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
      if (!session) router.replace('/login')
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) router.replace('/login')
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.ground, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.ground } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
      </Stack>
    </>
  )
}
