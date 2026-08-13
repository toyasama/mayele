import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

export function AppHeader() {
  return <View style={styles.header}>
    <View style={styles.brand}><View style={styles.logoShell}><Image source={require('@/assets/images/mayele-logo.png')} style={styles.logo} /></View><Text style={styles.name}>Mayele</Text></View>
    <View style={styles.actions}>
      <Pressable accessibilityLabel="Notifications" onPress={() => router.push('/notifications')} style={styles.iconButton}><Ionicons color="#143047" name="notifications-outline" size={22} /></Pressable>
      <Pressable accessibilityLabel="Menu" onPress={() => router.push('/menu')} style={styles.iconButton}><Ionicons color="#143047" name="menu" size={26} /></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  header: { height: 62, backgroundColor: '#fff', borderBottomColor: '#e4eeee', borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, logoShell: { width: 36, height: 40, borderRadius: 10, backgroundColor: '#f7fbfa', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#e2eceb' },
  logo: { width: 30, height: 30, resizeMode: 'contain' }, name: { color: '#10273a', fontSize: 16, fontWeight: '900' }, actions: { flexDirection: 'row', gap: 9 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#fff', borderWidth: 1, borderColor: '#dce9e9', alignItems: 'center', justifyContent: 'center', shadowColor: '#11293b', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
});
