import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, LayoutAnimation, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DailyObjective } from '@/lib/api';

let objectivesExpanded = true;

function configurationLabel(objective: DailyObjective) {
  const config = objective.launchConfig;
  return config.challengeMode === 'sprint'
    ? `${config.sprintDurationSeconds ?? 60} s`
    : `${config.tempoQuestionCount ?? 30} q · ${config.tempoQuestionSeconds ?? 10} s/q`;
}

export function DailyObjectives({ error, loading, objectives, onPrepare }: {
  error: string | null;
  loading: boolean;
  objectives: DailyObjective[];
  onPrepare: (objective: DailyObjective) => void;
}) {
  const [expanded, setExpanded] = useState(objectivesExpanded);
  const completed = objectives.filter((objective) => objective.completed || objective.claimed).length;
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    objectivesExpanded = !expanded;
    setExpanded(!expanded);
  };
  return <View style={[styles.section, !expanded && styles.sectionCollapsed]}>
    <Pressable accessibilityLabel={`${expanded ? 'Replier' : 'Déplier'} les objectifs du jour`} accessibilityRole="button" accessibilityState={{ expanded }} hitSlop={4} onPress={toggle} style={({ pressed }) => [styles.header, !expanded && styles.headerCollapsed, pressed && styles.headerPressed]}>
      <View style={styles.heading}><Ionicons color="#0b9f8f" name="flag-outline" size={17} /><Text style={styles.title}>Objectifs du jour</Text></View>
      <View style={styles.headerMeta}><Text style={styles.count}>{loading && !objectives.length ? 'Actualisation…' : `${completed}/${objectives.length} terminés`}</Text><View style={styles.chevron}><Ionicons color="#49636e" name={expanded ? 'chevron-up' : 'chevron-down'} size={16} /></View></View>
    </Pressable>
    {expanded && (objectives.length ? <ScrollView contentContainerStyle={styles.list} decelerationRate="fast" horizontal showsHorizontalScrollIndicator={false} snapToInterval={258}>
      {objectives.map((objective, index) => {
        const complete = objective.completed || objective.claimed;
        const progress = Math.max(0, Math.min(100, objective.progress));
        return <Pressable accessibilityHint="Prépare cette configuration de jeu" accessibilityRole="button" key={`${objective.scopeKey}-${objective.key}`} onPress={() => onPrepare(objective)} style={({ pressed }) => [styles.card, complete && styles.complete, pressed && styles.pressed]}>
          <View style={styles.cardTop}><View style={[styles.index, complete && styles.indexComplete]}>{complete ? <Ionicons color="#fff" name="checkmark" size={14} /> : <Text style={styles.indexText}>{index + 1}</Text>}</View><Text numberOfLines={2} style={styles.name}>{objective.title}</Text></View>
          <View style={styles.tags}><Text style={styles.tag}>{objective.tierLabel}</Text><Text style={styles.tag}>{objective.launchConfig.playContext === 'solo' ? 'Solo' : 'Multi'}</Text><Text style={styles.tag}>{objective.launchConfig.challengeMode === 'sprint' ? 'Sprint' : 'Tempo'}</Text><Text style={styles.tag}>{configurationLabel(objective)}</Text></View>
          <View style={styles.meta}><Text style={styles.progressText}>{objective.current}/{objective.target}</Text><Text style={styles.xp}>+{objective.rewardXp} XP</Text></View>
          <View style={styles.track}><View style={[styles.fill, { width: `${progress}%` }]} /></View>
        </Pressable>;
      })}
    </ScrollView> : <View style={styles.empty}>{loading ? <ActivityIndicator color="#0b9f8f" size="small" /> : <Ionicons color="#82949f" name="cloud-offline-outline" size={18} />}<Text style={styles.emptyText}>{error ?? 'Aucun objectif disponible aujourd’hui.'}</Text></View>)}
    {expanded && error && objectives.length ? <Text style={styles.warning}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { backgroundColor: '#effaf8', borderBottomColor: '#d2e9e7', borderBottomWidth: 1, paddingBottom: 10, paddingTop: 9 },
  sectionCollapsed: { paddingBottom: 7, paddingTop: 7 },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8, minHeight: 30, paddingHorizontal: 14 },
  headerCollapsed: { marginBottom: 0 },
  headerPressed: { opacity: 0.72 },
  headerMeta: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  chevron: { alignItems: 'center', backgroundColor: '#deefec', borderRadius: 12, height: 24, justifyContent: 'center', width: 24 },
  heading: { alignItems: 'center', flexDirection: 'row', gap: 7 }, title: { color: '#173246', fontSize: 12, fontWeight: '900' }, count: { color: '#667b85', fontSize: 10, fontWeight: '700' },
  list: { gap: 8, paddingHorizontal: 12, paddingRight: 24 }, card: { backgroundColor: '#fff', borderColor: '#d4e9e7', borderRadius: 14, borderWidth: 1, minHeight: 112, padding: 10, width: 250 }, complete: { backgroundColor: '#f4fbf8', borderColor: '#9bd8ce' }, pressed: { opacity: 0.78 },
  cardTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 }, index: { alignItems: 'center', backgroundColor: '#ecf9f7', borderColor: '#b8e6df', borderRadius: 11, borderWidth: 1, height: 22, justifyContent: 'center', width: 22 }, indexComplete: { backgroundColor: '#0b9f8f', borderColor: '#0b9f8f' }, indexText: { color: '#0b9f8f', fontSize: 11, fontWeight: '900' }, name: { color: '#173246', flex: 1, fontSize: 11, fontWeight: '900', lineHeight: 15 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6 }, tag: { backgroundColor: '#e4f4f0', borderRadius: 5, color: '#456e67', fontSize: 8, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 2 }, meta: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 }, progressText: { color: '#415b68', fontSize: 9, fontWeight: '900' }, xp: { color: '#0b9f8f', fontSize: 9, fontWeight: '900' }, track: { backgroundColor: '#c9e9e3', borderRadius: 4, height: 4, marginTop: 4, overflow: 'hidden' }, fill: { backgroundColor: '#0b9f8f', borderRadius: 4, height: 4 },
  empty: { alignItems: 'center', flexDirection: 'row', gap: 8, minHeight: 56, paddingHorizontal: 16 }, emptyText: { color: '#617681', fontSize: 12 }, warning: { color: '#91602c', fontSize: 10, marginHorizontal: 14, marginTop: 7 },
});
