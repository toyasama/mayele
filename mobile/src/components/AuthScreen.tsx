import { useSignIn, useSignUp } from '@clerk/expo';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type AuthFlow = 'signIn' | 'signUp' | 'forgotPassword';
type AuthStep = 'credentials' | 'verification' | 'newPassword';
type Feedback = { kind: 'error' | 'info'; text: string };

function errorMessage(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    if ('errors' in error) {
      const errors = (error as { errors?: { longMessage?: string; message?: string }[] }).errors;
      const message = errors?.[0]?.longMessage ?? errors?.[0]?.message;
      if (message) return message;
    }

    if ('longMessage' in error && typeof error.longMessage === 'string') return error.longMessage;
    if ('message' in error && typeof error.message === 'string') return error.message;
  }

  return error instanceof Error ? error.message : 'Une erreur est survenue. Réessaie.';
}

export function AuthScreen() {
  const { signIn, fetchStatus: signInStatus } = useSignIn();
  const { signUp, fetchStatus: signUpStatus } = useSignUp();
  const [flow, setFlow] = useState<AuthFlow>('signIn');
  const [step, setStep] = useState<AuthStep>('credentials');
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const busy = signInStatus === 'fetching' || signUpStatus === 'fetching';
  const email = emailAddress.trim().toLowerCase();

  const showError = (error: unknown) => setFeedback({ kind: 'error', text: errorMessage(error) });

  const finalizeSignIn = async () => {
    if (signIn.status !== 'complete') {
      throw new Error('La connexion demande une étape supplémentaire qui n’est pas encore prise en charge.');
    }
    await signIn.finalize({ navigate: async () => undefined });
  };

  const finalizeSignUp = async () => {
    if (signUp.status !== 'complete') {
      throw new Error('L’inscription n’a pas pu être finalisée. Vérifie le code et réessaie.');
    }
    await signUp.finalize({ navigate: async () => undefined });
  };

  const submitCredentials = async () => {
    if (!email) {
      setFeedback({ kind: 'error', text: 'Saisis ton adresse e-mail.' });
      return;
    }
    if (flow !== 'forgotPassword' && !password) {
      setFeedback({ kind: 'error', text: 'Saisis ton mot de passe.' });
      return;
    }

    setFeedback(null);
    try {
      if (flow === 'signIn') {
        const { error } = await signIn.password({ emailAddress: email, password });
        if (error) throw error;
        await finalizeSignIn();
        return;
      }

      if (flow === 'signUp') {
        const { error } = await signUp.password({ emailAddress: email, password });
        if (error) throw error;
        const { error: verificationError } = await signUp.verifications.sendEmailCode();
        if (verificationError) throw verificationError;
        setCode('');
        setStep('verification');
        return;
      }

      const { error: createError } = await signIn.create({ identifier: email });
      if (createError) throw createError;
      const { error: sendCodeError } = await signIn.resetPasswordEmailCode.sendCode();
      if (sendCodeError) throw sendCodeError;
      setCode('');
      setStep('verification');
    } catch (error) {
      showError(error);
    }
  };

  const verifyCode = async () => {
    if (!code.trim()) {
      setFeedback({ kind: 'error', text: 'Saisis le code reçu par e-mail.' });
      return;
    }

    setFeedback(null);
    try {
      if (flow === 'signUp') {
        const { error } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
        if (error) throw error;
        await finalizeSignUp();
        return;
      }

      const { error } = await signIn.resetPasswordEmailCode.verifyCode({ code: code.trim() });
      if (error) throw error;
      setPassword('');
      setStep('newPassword');
    } catch (error) {
      showError(error);
    }
  };

  const submitNewPassword = async () => {
    if (!password) {
      setFeedback({ kind: 'error', text: 'Saisis ton nouveau mot de passe.' });
      return;
    }

    setFeedback(null);
    try {
      const { error } = await signIn.resetPasswordEmailCode.submitPassword({
        password,
        signOutOfOtherSessions: true,
      });
      if (error) throw error;
      await finalizeSignIn();
    } catch (error) {
      showError(error);
    }
  };

  const resendCode = async () => {
    setFeedback(null);
    try {
      const { error } = flow === 'signUp'
        ? await signUp.verifications.sendEmailCode()
        : await signIn.resetPasswordEmailCode.sendCode();
      if (error) throw error;
      setFeedback({ kind: 'info', text: 'Un nouveau code vient d’être envoyé.' });
    } catch (error) {
      showError(error);
    }
  };

  const switchFlow = (nextFlow: AuthFlow) => {
    signIn.reset();
    signUp.reset();
    setFlow(nextFlow);
    setStep('credentials');
    setPassword('');
    setCode('');
    setFeedback(null);
  };

  const title = flow === 'signIn'
    ? 'Bienvenue sur Mayele'
    : flow === 'signUp'
      ? 'Créer un compte'
      : 'Mot de passe oublié';

  const subtitle = step === 'verification'
    ? `Saisis le code envoyé à ${email}.`
    : step === 'newPassword'
      ? 'Choisis un nouveau mot de passe pour ton compte.'
      : flow === 'signIn'
        ? 'Connecte-toi avec ton e-mail et ton mot de passe.'
        : flow === 'signUp'
          ? 'Crée ton compte Mayele, puis vérifie ton e-mail.'
          : 'Indique ton e-mail pour recevoir un code de réinitialisation.';

  const primaryLabel = step === 'verification'
    ? 'Valider le code'
    : step === 'newPassword'
      ? 'Enregistrer le mot de passe'
      : flow === 'signIn'
        ? 'Se connecter'
        : flow === 'signUp'
          ? 'Créer mon compte'
          : 'Recevoir le code';

  const submit = step === 'verification'
    ? verifyCode
    : step === 'newPassword'
      ? submitNewPassword
      : submitCredentials;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.keyboardView}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Image source={require('@/assets/images/mayele-logo.png')} style={styles.logo} />
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            {step === 'credentials' ? (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Adresse e-mail</Text>
                  <TextInput
                    accessibilityLabel="Adresse e-mail"
                    autoCapitalize="none"
                    autoComplete="email"
                    editable={!busy}
                    keyboardAppearance="light"
                    keyboardType="email-address"
                    onChangeText={setEmailAddress}
                    placeholder="nom@exemple.fr"
                    placeholderTextColor="#71818d"
                    selectionColor="#0a9f8f"
                    style={styles.input}
                    textContentType="emailAddress"
                    value={emailAddress}
                  />
                </View>
                {flow !== 'forgotPassword' ? (
                  <View style={styles.field}>
                    <Text style={styles.fieldLabel}>Mot de passe</Text>
                    <TextInput
                      accessibilityLabel="Mot de passe"
                      autoCapitalize="none"
                      autoComplete={flow === 'signUp' ? 'new-password' : 'current-password'}
                      editable={!busy}
                      keyboardAppearance="light"
                      onChangeText={setPassword}
                      onSubmitEditing={() => void submitCredentials()}
                      placeholder={flow === 'signUp' ? 'Choisis un mot de passe' : 'Saisis ton mot de passe'}
                      placeholderTextColor="#71818d"
                      returnKeyType="done"
                      secureTextEntry
                      selectionColor="#0a9f8f"
                      style={styles.input}
                      textContentType={flow === 'signUp' ? 'newPassword' : 'password'}
                      value={password}
                    />
                  </View>
                ) : null}
              </>
            ) : step === 'verification' ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Code de vérification</Text>
                <TextInput
                  accessibilityLabel="Code de vérification"
                  autoComplete="one-time-code"
                  editable={!busy}
                  keyboardAppearance="light"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={setCode}
                  onSubmitEditing={() => void verifyCode()}
                  placeholder="Code à 6 chiffres"
                  placeholderTextColor="#71818d"
                  selectionColor="#0a9f8f"
                  style={styles.input}
                  textContentType="oneTimeCode"
                  value={code}
                />
              </View>
            ) : (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Nouveau mot de passe</Text>
                <TextInput
                  accessibilityLabel="Nouveau mot de passe"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  editable={!busy}
                  keyboardAppearance="light"
                  onChangeText={setPassword}
                  onSubmitEditing={() => void submitNewPassword()}
                  placeholder="Choisis ton nouveau mot de passe"
                  placeholderTextColor="#71818d"
                  returnKeyType="done"
                  secureTextEntry
                  selectionColor="#0a9f8f"
                  style={styles.input}
                  textContentType="newPassword"
                  value={password}
                />
              </View>
            )}

            {feedback ? (
              <Text style={feedback.kind === 'error' ? styles.error : styles.info}>{feedback.text}</Text>
            ) : null}

            <Pressable
              disabled={busy}
              onPress={() => void submit()}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, busy && styles.disabled]}
            >
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{primaryLabel}</Text>}
            </Pressable>

            {step === 'verification' ? (
              <Pressable disabled={busy} onPress={() => void resendCode()} style={styles.linkButton}>
                <Text style={styles.linkText}>Renvoyer le code</Text>
              </Pressable>
            ) : null}

            {flow === 'signIn' && step === 'credentials' ? (
              <Pressable disabled={busy} onPress={() => switchFlow('forgotPassword')} style={styles.linkButton}>
                <Text style={styles.linkText}>Mot de passe oublié ?</Text>
              </Pressable>
            ) : null}

            {flow === 'signIn' && step === 'credentials' ? (
              <Pressable disabled={busy} onPress={() => switchFlow('signUp')} style={styles.linkButton}>
                <Text style={styles.linkText}>Pas encore de compte ? Créer un compte</Text>
              </Pressable>
            ) : (
              <Pressable disabled={busy} onPress={() => switchFlow('signIn')} style={styles.linkButton}>
                <Text style={styles.linkText}>Retour à la connexion</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f5f9fb' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', padding: 22 },
  card: { backgroundColor: '#fff', borderRadius: 24, padding: 24, gap: 14, borderWidth: 1, borderColor: '#d9e7ec' },
  logo: { alignSelf: 'center', width: 82, height: 62, resizeMode: 'contain' },
  title: { color: '#061b2f', fontSize: 28, fontWeight: '900', textAlign: 'center' },
  subtitle: { color: '#526776', fontSize: 16, lineHeight: 23, marginBottom: 2, textAlign: 'center' },
  field: { gap: 6 },
  fieldLabel: { color: '#173246', fontSize: 13, fontWeight: '800', marginLeft: 2 },
  input: { backgroundColor: '#f8fbfc', borderColor: '#9fb9c3', borderRadius: 14, borderWidth: 1, color: '#061b2f', fontSize: 17, paddingHorizontal: 16, paddingVertical: 15 },
  error: { color: '#a53127', fontSize: 14, lineHeight: 20 },
  info: { color: '#087f73', fontSize: 14, lineHeight: 20 },
  primaryButton: { alignItems: 'center', backgroundColor: '#0a9f8f', borderRadius: 14, minHeight: 52, justifyContent: 'center', paddingHorizontal: 16 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  linkButton: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5 },
  linkText: { color: '#087f73', fontSize: 14, fontWeight: '700', textAlign: 'center' },
  pressed: { opacity: 0.82 },
  disabled: { opacity: 0.65 },
});
