/**
 * Explore tab — placeholder until Phase M4 wires real Explore data.
 * No fake numbers: it renders an honest empty state only.
 */

import { SafeAreaView } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { ScreenHeader, StateView } from '@/src/ui'

export default function ExploreScreen() {
  return (
    <SafeAreaView className="flex-1 bg-ground" edges={['top']}>
      <View className="flex-1 px-screen">
        <ScreenHeader
          title="Explore"
          subtitle="A small, fenced-off part of your money for strategies and copying traders. Your core portfolio is never touched."
        />
        <StateView
          kind="empty"
          title="Explore is being set up"
          detail="This screen is part of the current build and switches on in the next update."
        />
      </View>
    </SafeAreaView>
  )
}
