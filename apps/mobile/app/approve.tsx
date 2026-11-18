/** Approve modal — implemented in Phase M3. */
import { SafeAreaView } from 'react-native-safe-area-context'
import { StateView } from '@/src/ui'

export default function ApproveScreen() {
  return (
    <SafeAreaView className="flex-1 bg-ground">
      <StateView kind="empty" title="Nothing to approve yet" />
    </SafeAreaView>
  )
}
