import { Tabs } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'

type IoniconsName = React.ComponentProps<typeof Ionicons>['name']

const TABS: { name: string; title: string; icon: IoniconsName; activeIcon: IoniconsName }[] = [
  { name: 'index',     title: 'Dashboard', icon: 'grid-outline',       activeIcon: 'grid' },
  { name: 'feed',      title: 'Feed',      icon: 'pulse-outline',      activeIcon: 'pulse' },
  { name: 'traders',   title: 'Traders',   icon: 'people-outline',     activeIcon: 'people' },
  { name: 'portfolio', title: 'Portfolio', icon: 'bar-chart-outline',  activeIcon: 'bar-chart' },
  { name: 'alerts',    title: 'Alerts',    icon: 'notifications-outline', activeIcon: 'notifications' },
]

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0a0b0f',
          borderTopColor: 'rgba(255,255,255,0.08)',
          borderTopWidth: 1,
          height: 88,
          paddingBottom: 24,
          paddingTop: 10,
        },
        tabBarActiveTintColor: '#6366f1',
        tabBarInactiveTintColor: '#6b7280',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
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
