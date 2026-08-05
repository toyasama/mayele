import { useAuth, useUser } from '@clerk/expo';
import { AuthView, UserButton } from '@clerk/expo/native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { apiBaseLabel, getCurrentPlayer, type Player } from '@/lib/api';

type ProfileState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; player: Player }
  | { status: 'error'; message: string };

export default function HomeScreen() {
  const { getToken, isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { user } = useUser();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [profile, setProfile] = useState<ProfileState>({ status: 'idle' });

  const loadProfile = useCallback(async () => {
    if (!isSignedIn) {
      setProfile({ status: 'idle' });
      return;
    }

    setProfile({ status: 'loading' });

    try {
      const player = await getCurrentPlayer(getToken);
      setProfile({ status: 'success', player });
    } catch (error) {
      setProfile({
        status: 'error',
        message: error instanceof Error ? error.message : 'Impossible de joindre l’API Mayele.',
      });
    }
  }, [getToken, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) {
      return;
    }

    let isCurrent = true;

    void getCurrentPlayer(getToken)
      .then((player) => {
        if (isCurrent) {
          setProfile({ status: 'success', player });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setProfile({
            status: 'error',
            message: error instanceof Error ? error.message : 'Impossible de joindre l’API Mayele.',
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [getToken, isSignedIn]);

  if (!isLoaded) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color="#0a9f8f" size="large" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            isSignedIn ? (
              <RefreshControl
                refreshing={profile.status === 'loading'}
                onRefresh={() => void loadProfile()}
                tintColor="#0a9f8f"
              />
            ) : undefined
          }
        >
          <View style={styles.header}>
            <View style={styles.brand}>
              <Image source={require('@/assets/images/mayele-logo.png')} style={styles.logo} />
              <View>
                <Text style={styles.eyebrow}>MAYELE</Text>
                <Text style={styles.brandTitle}>Maths</Text>
              </View>
            </View>
            {isSignedIn ? <UserButton /> : null}
          </View>

          <View style={styles.hero}>
            <Text style={styles.heroKicker}>{isSignedIn ? 'APP MOBILE CONNECTÉE' : 'APP IOS EN DÉVELOPPEMENT'}</Text>
            <Text style={styles.heroTitle}>
              {isSignedIn
                ? `Bonjour ${user?.firstName ?? user?.username ?? ''}`.trim()
                : 'Apprends et progresse, où que tu sois.'}
            </Text>
            <Text style={styles.heroText}>
              {isSignedIn
                ? 'Ton identité Clerk est active. Cette première vue valide aussi la connexion au backend Mayele existant.'
                : 'Connecte-toi avec le même compte que sur la webapp pour tester le socle natif sur ton iPhone.'}
            </Text>

            {!isSignedIn ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsAuthOpen(true)}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.primaryButtonText}>Se connecter ou créer un compte</Text>
              </Pressable>
            ) : null}
          </View>

          {isSignedIn ? <ConnectionCard profile={profile} onRetry={loadProfile} /> : <DevelopmentCard />}
        </ScrollView>
      </SafeAreaView>

      <Modal
        animationType="slide"
        onRequestClose={() => setIsAuthOpen(false)}
        presentationStyle="pageSheet"
        visible={isAuthOpen && !isSignedIn}
      >
        <SafeAreaView style={styles.authModal}>
          <AuthView
            isDismissible
            logo={<Image source={require('@/assets/images/mayele-logo.png')} style={styles.authLogo} />}
            mode="signInOrUp"
            onDismiss={() => setIsAuthOpen(false)}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function ConnectionCard({ profile, onRetry }: { profile: ProfileState; onRetry: () => Promise<void> }) {
  if (profile.status === 'loading' || profile.status === 'idle') {
    return (
      <View style={styles.card}>
        <ActivityIndicator color="#0a9f8f" />
        <Text style={styles.cardText}>Connexion à l’API Mayele…</Text>
      </View>
    );
  }

  if (profile.status === 'error') {
    return (
      <View style={[styles.card, styles.errorCard]}>
        <Text style={styles.cardTitle}>API indisponible</Text>
        <Text style={styles.cardText}>{profile.message}</Text>
        <Text style={styles.endpoint}>{apiBaseLabel}</Text>
        <Pressable onPress={() => void onRetry()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Réessayer</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <View style={styles.statusDot} />
        <Text style={styles.cardTitle}>Backend connecté</Text>
      </View>
      <Text style={styles.cardText}>
        Profil Mayele : {profile.player.profileComplete ? 'complet' : 'à compléter sur la webapp'}
      </Text>
      <Text style={styles.endpoint}>{apiBaseLabel}</Text>
    </View>
  );
}

function DevelopmentCard() {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Boucle de développement prête</Text>
      <Text style={styles.cardText}>
        Une fois la development build installée, lance npm start puis scanne le QR code. Les changements TypeScript apparaîtront sans nouvelle compilation native.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f9fb' },
  safeArea: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f9fb' },
  content: { flexGrow: 1, paddingHorizontal: 22, paddingBottom: 40 },
  header: { minHeight: 82, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 45, height: 46, resizeMode: 'contain' },
  eyebrow: { color: '#0a9f8f', fontSize: 11, fontWeight: '900', letterSpacing: 2.4 },
  brandTitle: { color: '#003048', fontSize: 22, fontWeight: '900', lineHeight: 24 },
  hero: { marginTop: 28, paddingVertical: 34 },
  heroKicker: { color: '#0a9f8f', fontSize: 12, fontWeight: '900', letterSpacing: 1.7 },
  heroTitle: { color: '#061b2f', fontSize: 40, fontWeight: '900', letterSpacing: -1.4, lineHeight: 45, marginTop: 12 },
  heroText: { color: '#5d6f7f', fontSize: 17, lineHeight: 26, marginTop: 17, maxWidth: 520 },
  primaryButton: { alignItems: 'center', backgroundColor: '#0a9f8f', borderRadius: 16, marginTop: 28, paddingHorizontal: 20, paddingVertical: 17 },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800', textAlign: 'center' },
  buttonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  card: { backgroundColor: '#ffffff', borderColor: '#d9e7ec', borderRadius: 20, borderWidth: 1, gap: 10, padding: 20, shadowColor: '#142037', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.07, shadowRadius: 20, elevation: 3 },
  errorCard: { borderColor: '#f0c9c4' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  statusDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#37a954' },
  cardTitle: { color: '#061b2f', fontSize: 17, fontWeight: '800' },
  cardText: { color: '#5d6f7f', fontSize: 15, lineHeight: 22 },
  endpoint: { color: '#718392', fontFamily: 'monospace', fontSize: 12 },
  secondaryButton: { alignSelf: 'flex-start', borderColor: '#0a9f8f', borderRadius: 12, borderWidth: 1, marginTop: 4, paddingHorizontal: 15, paddingVertical: 10 },
  secondaryButtonText: { color: '#087f73', fontSize: 14, fontWeight: '800' },
  authModal: { flex: 1, backgroundColor: '#ffffff' },
  authLogo: { alignSelf: 'center', width: 74, height: 76, resizeMode: 'contain' },
});
