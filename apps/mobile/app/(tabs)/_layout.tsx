/**
 * Simple-mode tab bar (Phase M1): Home, Goals, Activity, Explore.
 *
 * The legacy screens (feed, traders, portfolio, alerts, profile) keep their
 * files until the new screens fully replace them (Phase M6) but are hidden
 * from the tab bar with `href: null`.
 */

import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { colors } from '@/src/theme'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TABS: { name: string; title: string; icon: IoniconsName; activeIcon: IoniconsName }[] = [
  { name: 'index',    title: 'Home',     icon: 'home-outline',    activeIcon: 'home' },
  { name: 'goals',    title: 'Goals',    icon: 'disc-outline',    activeIcon: 'disc' },
  { name: 'activity', title: 'Activity', icon: 'list-outline',    activeIcon: 'list' },
  { name: 'explore',  title: 'Explore',  icon: 'compass-outline', activeIcon: 'compass' },
]

/** Old six-tab screens, hidden until Phase M6 deletes them. */
const LEGACY_HIDDEN = ['feed', 'traders', 'portfolio', 'alerts', 'profile']

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.ground },
        tabBarStyle: {
          backgroundColor: colors.ground,
          borderTopColor: colors.stroke,
          borderTopWidth: 1,
          height: 88,
          paddingBottom: 24,
          paddingTop: 8,
        },
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
      {LEGACY_HIDDEN.map(name => (
        <Tabs.Screen key={name} name={name} options={{ href: null }} />
      ))}
    </Tabs>
  )
}
