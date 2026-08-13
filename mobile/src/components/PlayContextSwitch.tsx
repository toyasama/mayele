import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type PlayContext = 'solo' | 'multiplayer';

export function PlayContextSwitch({ active, onChange }: { active: PlayContext; onChange: (next: PlayContext) => void }) {
  return <View accessibilityRole="tablist" style={styles.shell}>
    <ContextButton active={active === 'solo'} icon="person-outline" label="Solo" onPress={() => onChange('solo')} />
    <ContextButton active={active === 'multiplayer'} icon="people-outline" label="Multijoueur" onPress={() => onChange('multiplayer')} />
  </View>;
}

function ContextButton({ active, icon, label, onPress }: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return <Pressable
    accessibilityRole="tab"
    accessibilityState={{ selected: active }}
    onPress={onPress}
    style={({ pressed }) => [styles.button, active && styles.active, pressed && styles.pressed]}
  >
    <Ionicons color={active ? '#fff' : '#617783'} name={icon} size={17} />
    <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  shell: { alignSelf: 'center', backgroundColor: '#e6f1ef', borderRadius: 15, flexDirection: 'row', gap: 3, marginTop: 10, padding: 3, width: 268 },
  button: { alignItems: 'center', borderRadius: 12, flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', minHeight: 38, paddingHorizontal: 10 },
  active: { backgroundColor: '#0b9f8f', shadowColor: '#08766c', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.16, shadowRadius: 5 },
  label: { color: '#536a76', fontSize: 12, fontWeight: '900' },
  activeLabel: { color: '#fff' },
  pressed: { opacity: 0.8 },
});
