/**
 * Activity tab — placeholder until Phase M3 wires real activity data.
 * No fake numbers: it renders an honest empty state only.
 */

import { SafeAreaView } from 'react-native-safe-area-context'
import { View } from 'react-native'
import { ScreenHeader, StateView } from '@/src/ui'

export default function ActivityScreen() {
  return (
    <SafeAreaView className="flex-1 bg-ground" edges={['top']}>
      <View className="flex-1 px-screen">
        <ScreenHeader title="Activity" />
        <StateView
          kind="empty"
          title="Everything the app does shows up here"
          detail="This screen is part of the current build and switches on in the next update."
        />
      </View>
    </SafeAreaView>
  )
}
