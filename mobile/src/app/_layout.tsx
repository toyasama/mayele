import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { getMobileConfigResult } from '@/lib/config';

function Navigation() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <View style={styles.loading}><ActivityIndicator color="#11a696" size="large" /></View>;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f4f8f8' } }}>
      <Stack.Screen name="index" />
      <Stack.Protected guard={!isSignedIn}><Stack.Screen name="sign-in" /></Stack.Protected>
      <Stack.Protected guard={Boolean(isSignedIn)}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="game/[runId]" />
        <Stack.Screen name="multiplayer/[matchId]" />
        <Stack.Screen name="space/[section]" />
        <Stack.Screen name="friends/[section]" />
        <Stack.Screen name="menu" />
        <Stack.Screen name="notifications" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const result = getMobileConfigResult();
  if (!result.config) return <View style={styles.error}><Text style={styles.title}>Configuration mobile incomplète</Text><Text style={styles.text}>{result.error}</Text><Text style={styles.hint}>Corrige mobile/.env.local puis relance Expo.</Text></View>;
  return <ClerkProvider publishableKey={result.config.clerkPublishableKey} tokenCache={tokenCache}><StatusBar style="dark" /><Navigation /></ClerkProvider>;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f8f8' },
  error: { flex: 1, justifyContent: 'center', padding: 28, backgroundColor: '#fff7f5' },
  title: { color: '#8f241c', fontSize: 22, fontWeight: '800' }, text: { color: '#5f302c', fontSize: 16, lineHeight: 23, marginTop: 14 }, hint: { color: '#765b58', fontSize: 14, marginTop: 18 },
});
