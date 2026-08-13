import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const bottomPadding = Math.max(insets.bottom, 8);

  return <Tabs screenOptions={{
    headerShown: false,
    tabBarActiveBackgroundColor: '#e7f7f4',
    tabBarActiveTintColor: '#078f81',
    tabBarHideOnKeyboard: true,
    tabBarInactiveTintColor: '#758792',
    tabBarIconStyle: { marginTop: 1 },
    tabBarItemStyle: { borderRadius: 17, marginBottom: 5, marginHorizontal: 4, marginTop: 5, overflow: 'hidden' },
    tabBarLabelStyle: { fontSize: 10, fontWeight: '800', marginBottom: 1 },
    tabBarStyle: {
      backgroundColor: '#fff',
      borderTopColor: '#e4eded',
      borderTopWidth: 1,
      elevation: 12,
      height: 62 + bottomPadding,
      paddingBottom: bottomPadding,
      paddingHorizontal: 7,
      shadowColor: '#173246',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
    },
  }}>
    <Tabs.Screen name="play" options={{ title: 'Jouer', tabBarIcon: ({ color, focused, size }) => <Ionicons color={color} name={focused ? 'flash' : 'flash-outline'} size={size} /> }} />
    <Tabs.Screen name="space" options={{ title: 'Mon espace', tabBarIcon: ({ color, focused, size }) => <Ionicons color={color} name={focused ? 'grid' : 'grid-outline'} size={size} /> }} />
    <Tabs.Screen name="friends" options={{ title: 'Amis', tabBarIcon: ({ color, focused, size }) => <Ionicons color={color} name={focused ? 'people' : 'people-outline'} size={size} /> }} />
    <Tabs.Screen name="multiplayer" options={{ href: null }} />
  </Tabs>;
}
