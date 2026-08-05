import { ClerkProvider } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

const clerkPublishableKey = 'pk_test_ZmluZXItaWd1YW5hLTUuY2xlcmsuYWNjb3VudHMuZGV2JA';

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={clerkPublishableKey} tokenCache={tokenCache}>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </ClerkProvider>
  );
}
