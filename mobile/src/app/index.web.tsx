import { useAuth } from '@clerk/expo';
import { SignInButton, UserButton } from '@clerk/expo/web';
import { StyleSheet, Text, View } from 'react-native';

export default function WebHomeScreen() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mayele Maths mobile</Text>
      <Text style={styles.body}>Ce client est conçu pour iOS et Android. La webapp Mayele reste le client web principal.</Text>
      {isLoaded && !isSignedIn ? (
        <SignInButton>
          <Text style={styles.link}>Se connecter</Text>
        </SignInButton>
      ) : null}
      {isLoaded && isSignedIn ? <UserButton /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, backgroundColor: '#f5f9fb' },
  title: { color: '#061b2f', fontSize: 32, fontWeight: '900' },
  body: { color: '#5d6f7f', fontSize: 17, lineHeight: 26, maxWidth: 560, textAlign: 'center' },
  link: { color: '#0a9f8f', fontSize: 16, fontWeight: '800' },
});
