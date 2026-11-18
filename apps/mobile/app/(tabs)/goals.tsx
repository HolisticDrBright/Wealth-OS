/**
 * Goals tab — placeholder until Phase M2 wires real goal data.
 * No fake numbers: it renders an honest empty state only.
 */

import { SafeAreaView } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { ScreenHeader, StateView } from '@/src/ui'

export default function GoalsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-ground" edges={['top']}>
      <View className="flex-1 px-screen">
        <ScreenHeader title="Goals" />
        <StateView
          kind="empty"
          title="Your goals will live here"
          detail="This screen is part of the current build and switches on in the next update."
        />
      </View>
    </SafeAreaView>
  )
}
