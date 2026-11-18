/**
 * Simple-mode tab bar: Home, Goals, Activity, Explore.
 */

import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors } from '@/src/theme'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TABS: { name: string; title: string; icon: IoniconsName; activeIcon: IoniconsName }[] = [
  { name: 'index',    title: 'Home',     icon: 'home-outline',    activeIcon: 'home' },
  { name: 'goals',    title: 'Goals',    icon: 'disc-outline',    activeIcon: 'disc' },
  { name: 'activity', title: 'Activity', icon: 'list-outline',    activeIcon: 'list' },
  { name: 'explore',  title: 'Explore',  icon: 'compass-outline', activeIcon: 'compass' },
]

export default function TabLayout() {
  const insets = useSafeAreaInsets()
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.ground },
        tabBarStyle: {
          backgroundColor: colors.ground,
          borderTopColor: colors.stroke,
          borderTopWidth: 1,
          // Safe-area driven, not a fixed height: min 56pt row + the inset.
          minHeight: 56 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 8),
          paddingTop: 6,
        },
        tabBarAllowFontScaling: true,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
      }}
    >
      {TABS.map(tab => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: tab.title,
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? tab.activeIcon : tab.icon} size={size} color={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  )
}
