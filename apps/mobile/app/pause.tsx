/** Pause modal — implemented in Phase M4. */
import { SafeAreaView } from 'react-native-safe-area-context'
import { StateView } from '@/src/ui'

export default function PauseScreen() {
  return (
    <SafeAreaView className="flex-1 bg-ground">
      <StateView kind="empty" title="Pause controls are coming in the next update" />
    </SafeAreaView>
  )
}
