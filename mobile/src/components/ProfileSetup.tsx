import { useUser } from '@clerk/expo';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { type Player, type TokenProvider, updateCurrentPlayer } from '@/lib/api';

export function ProfileSetup({ getToken, onComplete }: { getToken: TokenProvider; onComplete: (player: Player) => void }) {
  const { user } = useUser();
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [birthDate, setBirthDate] = useState('');
  const [username, setUsername] = useState(user?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (firstName.trim().length < 2 || lastName.trim().length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !/^[a-zA-Z0-9_]{3,24}$/.test(username.trim())) {
      setError('Vérifie les champs : date au format AAAA-MM-JJ et pseudo de 3 à 24 caractères.'); return;
    }
    setBusy(true); setError(null);
    try { onComplete(await updateCurrentPlayer(getToken, { firstName: firstName.trim(), lastName: lastName.trim(), birthDate, username: username.trim(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible d’enregistrer le profil.'); }
    finally { setBusy(false); }
  };

  return <View style={styles.wrap}><Text style={styles.eyebrow}>DERNIÈRE ÉTAPE</Text><Text style={styles.title}>Complète ton profil</Text><Text style={styles.text}>Ces informations permettent d’enregistrer tes parties et ta progression Mayele.</Text>
    <View style={styles.two}><TextInput editable={!busy} onChangeText={setFirstName} placeholder="Prénom" style={[styles.input, styles.half]} value={firstName} /><TextInput editable={!busy} onChangeText={setLastName} placeholder="Nom" style={[styles.input, styles.half]} value={lastName} /></View>
    <TextInput autoCapitalize="none" editable={!busy} onChangeText={setUsername} placeholder="Pseudo (ex. emery_7)" style={styles.input} value={username} />
    <TextInput editable={!busy} keyboardType="numbers-and-punctuation" maxLength={10} onChangeText={setBirthDate} placeholder="Date de naissance AAAA-MM-JJ" style={styles.input} value={birthDate} />
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable disabled={busy} onPress={() => void save()} style={[styles.button, busy && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Enregistrer et jouer</Text>}</Pressable>
  </View>;
}
const styles = StyleSheet.create({ wrap: { margin: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d4e8e6', borderRadius: 20, padding: 20, gap: 13 }, eyebrow: { color: '#11a696', fontSize: 10, letterSpacing: 3, fontWeight: '900' }, title: { color: '#102a3e', fontSize: 27, fontWeight: '900' }, text: { color: '#627681', fontSize: 14, lineHeight: 20 }, two: { flexDirection: 'row', gap: 9 }, input: { height: 50, borderRadius: 13, borderWidth: 1, borderColor: '#cbdfdf', backgroundColor: '#fbfdfd', color: '#102a3e', paddingHorizontal: 14, fontSize: 15 }, half: { flex: 1 }, error: { color: '#a43a32', fontSize: 13, lineHeight: 19 }, button: { height: 51, backgroundColor: '#11a696', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: '#fff', fontSize: 15, fontWeight: '900' }, disabled: { opacity: 0.6 } });
