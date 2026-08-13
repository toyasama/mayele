import { Ionicons } from '@expo/vector-icons';
import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export function NumericKeypad({ answer, busy, onChange, onSubmit }: {
  answer: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const valueRef = useRef(answer);
  const lastAnswerPropRef = useRef(answer);
  if (lastAnswerPropRef.current !== answer) {
    lastAnswerPropRef.current = answer;
    valueRef.current = answer;
  }

  const commit = (value: string) => {
    valueRef.current = value;
    onChange(value);
  };
  const add = (key: string) => {
    const current = valueRef.current;
    if (key === '-') return commit(current.startsWith('-') ? current.slice(1) : `-${current}`);
    if (current.length >= 8) return;
    commit(`${current}${key}`);
  };
  const erase = () => commit(valueRef.current.slice(0, -1));
  const clear = () => commit('');
  const canSubmit = /^-?\d+$/.test(answer);
  const numberKeys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

  return <View accessibilityLabel="Clavier numérique" style={styles.keypad}>
    <View style={styles.grid}>{numberKeys.map((key) => <KeyButton busy={busy} key={key} label={key} onPress={() => add(key)} />)}</View>
    <View style={styles.bottom}>
      <KeyButton accessibilityLabel="Changer le signe" busy={busy} label="−" onPress={() => add('-')} />
      <KeyButton busy={busy} label="0" onPress={() => add('0')} />
      <Pressable accessibilityLabel="Effacer" disabled={busy || !answer} onLongPress={clear} onPress={erase} style={({ pressed }) => [styles.key, pressed && styles.keyPressed, !answer && styles.disabled]}>{({ pressed }) => <Ionicons color={pressed ? '#fff' : '#173246'} name="backspace-outline" size={25} />}</Pressable>
    </View>
    <Pressable accessibilityLabel="Valider la réponse" disabled={busy || !canSubmit} onPress={onSubmit} style={({ pressed }) => [styles.validate, pressed && styles.validatePressed, (busy || !canSubmit) && styles.disabled]}><Text style={styles.validateText}>Valider la réponse</Text><Ionicons color="#fff" name="arrow-forward" size={20} /></Pressable>
  </View>;
}

function KeyButton({ accessibilityLabel, busy, label, onPress }: { accessibilityLabel?: string; busy: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityLabel={accessibilityLabel ?? label} disabled={busy} onPress={onPress} style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}>{({ pressed }) => <Text style={[styles.keyText, pressed && styles.keyTextPressed]}>{label}</Text>}</Pressable>;
}

const styles = StyleSheet.create({
  keypad: { backgroundColor: 'rgba(220,239,236,0.92)', borderColor: '#d5e8e5', borderRadius: 20, borderWidth: 1, gap: 7, padding: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, bottom: { flexDirection: 'row', gap: 7 },
  key: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#c9dddc', borderRadius: 12, borderWidth: 1, flexBasis: '31%', flexGrow: 1, height: 43, justifyContent: 'center', shadowColor: '#18394a', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2 },
  keyPressed: { backgroundColor: '#0aa493', borderColor: '#0aa493', transform: [{ scale: 0.97 }] },
  keyText: { color: '#102a3e', fontSize: 21, fontWeight: '900' }, keyTextPressed: { color: '#fff' },
  validate: { alignItems: 'center', backgroundColor: '#0aa493', borderRadius: 12, flexDirection: 'row', gap: 8, height: 46, justifyContent: 'center' }, validatePressed: { backgroundColor: '#087f73', transform: [{ scale: 0.985 }] }, validateText: { color: '#fff', fontSize: 14, fontWeight: '900' }, disabled: { opacity: 0.45 },
});
