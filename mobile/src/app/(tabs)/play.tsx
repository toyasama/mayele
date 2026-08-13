import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MultiplayerScreen } from './multiplayer';

import { AppHeader } from '@/components/AppHeader';
import { DailyObjectives } from '@/components/DailyObjectives';
import { PlayContextSwitch } from '@/components/PlayContextSwitch';
import { ProfileSetup } from '@/components/ProfileSetup';
import { useStableToken } from '@/hooks/useStableToken';
import { useDailyObjectives } from '@/hooks/useDailyObjectives';
import {
  getCurrentPlayer,
  type DailyObjective,
  type GameLevel,
  type GameMode,
  type GameType,
  type Player,
  startSoloRun,
} from '@/lib/api';

const sprintDurations = [60, 90, 120] as const;
const operations: { value: GameType; label: string }[] = [
  { value: 'addition', label: '+' },
  { value: 'soustraction', label: '−' },
  { value: 'multiplication', label: '×' },
  { value: 'division', label: '÷' },
  { value: 'mixte', label: 'Mixte' },
];
const levels: { value: GameLevel; label: string }[] = [
  { value: 'debutant', label: 'Débutant' },
  { value: 'intermediaire', label: 'Intermédiaire' },
  { value: 'avance', label: 'Avancé' },
  { value: 'expert', label: 'Expert' },
];

function isSprintDuration(value: number): value is (typeof sprintDurations)[number] {
  return sprintDurations.includes(value as (typeof sprintDurations)[number]);
}

export default function PlayScreen() {
  const routeParams = useLocalSearchParams<{ context?: string }>();
  const getToken = useStableToken();
  const [player, setPlayer] = useState<Player | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const { objectives, objectivesError, objectivesLoading } = useDailyObjectives(getToken);
  const [mode, setMode] = useState<GameMode>('sprint');
  const [game, setGame] = useState<GameType>('addition');
  const [level, setLevel] = useState<GameLevel>('debutant');
  const [duration, setDuration] = useState<(typeof sprintDurations)[number]>(60);
  const [tempoQuestionCount, setTempoQuestionCount] = useState(30);
  const [tempoQuestionSeconds, setTempoQuestionSeconds] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modeHelpOpen, setModeHelpOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void getCurrentPlayer(getToken)
      .then((nextPlayer) => { if (active) setPlayer(nextPlayer); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Profil indisponible.'); })
      .finally(() => { if (active) setProfileLoading(false); });
    return () => { active = false; };
  }, [getToken]);

  const start = async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const run = await startSoloRun(getToken, {
        clientRunId: Crypto.randomUUID(),
        mode,
        game,
        level,
        practiceSkill: null,
        sprintDurationSeconds: duration,
        tempoQuestionCount,
        tempoQuestionSeconds,
      });
      router.push({ pathname: '/game/[runId]', params: { runId: run.id } });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Impossible de démarrer la partie.');
    } finally {
      setLoading(false);
    }
  };

  const prepareObjective = (objective: DailyObjective) => {
    if (objective.launchConfig.playContext !== 'solo') {
      const config = objective.launchConfig;
      router.push({
        pathname: '/play',
        params: {
          context: 'multiplayer',
          game: config.game,
          level: config.level,
          mode: config.challengeMode,
          objective: objective.key,
          questions: config.tempoQuestionCount ? String(config.tempoQuestionCount) : undefined,
          seconds: config.tempoQuestionSeconds ? String(config.tempoQuestionSeconds) : undefined,
          duration: config.sprintDurationSeconds ? String(config.sprintDurationSeconds) : undefined,
        },
      });
      return;
    }

    const config = objective.launchConfig;
    setMode(config.challengeMode);
    setGame(config.game);
    setLevel(config.level);
    if (config.sprintDurationSeconds && isSprintDuration(config.sprintDurationSeconds)) {
      setDuration(config.sprintDurationSeconds);
    }
    if (config.tempoQuestionCount) setTempoQuestionCount(config.tempoQuestionCount);
    if (config.tempoQuestionSeconds) setTempoQuestionSeconds(config.tempoQuestionSeconds);
    setError(null);
    setNotice(`Configuration préparée pour « ${objective.title} ».`);
  };

  if (paramValue(routeParams.context) === 'multiplayer') return <MultiplayerScreen />;

  if (profileLoading) {
    return <SafeAreaView edges={['top']} style={styles.safe}><AppHeader /><View style={styles.center}><ActivityIndicator color="#0b9f8f" size="large" /><Text style={styles.centerText}>Préparation de ton espace de jeu…</Text></View></SafeAreaView>;
  }

  if (player && !player.profileComplete) {
    return <SafeAreaView edges={['top']} style={styles.safe}><AppHeader /><ScrollView contentContainerStyle={styles.profileContent}><ProfileSetup getToken={getToken} onComplete={setPlayer} /></ScrollView></SafeAreaView>;
  }

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <AppHeader />
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <DailyObjectives
        error={objectivesError}
        loading={objectivesLoading}
        objectives={objectives}
        onPrepare={prepareObjective}
      />

      <PlayContextSwitch active="solo" onChange={(next) => { if (next === 'multiplayer') router.push({ pathname: '/play', params: { context: 'multiplayer' } }); }} />

      <View style={styles.heading}>
        <Text style={styles.eyebrow}>{mode === 'sprint' ? `SPRINT · ${duration} S` : `TEMPO · ${tempoQuestionCount} QUESTIONS`}</Text>
        <Text style={styles.title}>{mode === 'sprint' ? 'Sprint' : 'Tempo'}</Text>
      </View>

      <View style={styles.panel}>
        <ChoiceRow label="MODE" onHelp={() => setModeHelpOpen(true)}>
          <Segment label="Sprint" detail="Contre la montre" active={mode === 'sprint'} onPress={() => { setMode('sprint'); setNotice(null); }} />
          <Segment label="Tempo" detail="Question par question" active={mode === 'tempo'} onPress={() => { setMode('tempo'); setNotice(null); }} />
        </ChoiceRow>

        {mode === 'sprint' ? (
          <ChoiceRow label="DURÉE">
            {sprintDurations.map((seconds) => <Pill key={seconds} layout="third" label={`${seconds} s`} active={duration === seconds} onPress={() => { setDuration(seconds); setNotice(null); }} />)}
          </ChoiceRow>
        ) : (
          <View style={styles.tempoSettings}>
            <Stepper label="QUESTIONS" value={tempoQuestionCount} min={10} max={50} step={5} onChange={(value) => { setTempoQuestionCount(value); setNotice(null); }} />
            <Stepper label="SECONDES / Q" value={tempoQuestionSeconds} min={5} max={30} step={1} onChange={(value) => { setTempoQuestionSeconds(value); setNotice(null); }} />
          </View>
        )}

        <ChoiceRow label="OPÉRATION">
          {operations.map((item) => <Pill key={item.value} layout="operation" label={item.label} mixed={item.value === 'mixte'} active={game === item.value} onPress={() => { setGame(item.value); setNotice(null); }} />)}
        </ChoiceRow>

        <ChoiceRow label="NIVEAU">
          {levels.map((item) => <Pill key={item.value} layout="half" label={item.label} active={level === item.value} onPress={() => { setLevel(item.value); setNotice(null); }} dotted />)}
        </ChoiceRow>

        {notice ? <View style={styles.noticeBox}><Ionicons color="#087f73" name="checkmark-circle-outline" size={18} /><Text style={styles.noticeText}>{notice}</Text></View> : null}
        {error ? <View style={styles.errorBox}><Ionicons color="#b53a32" name="alert-circle-outline" size={19} /><Text style={styles.errorText}>{error}</Text></View> : null}

        <Pressable disabled={loading} onPress={() => void start()} style={({ pressed }) => [styles.startButton, pressed && styles.pressed, loading && styles.disabled]}>
          {loading ? <ActivityIndicator color="#fff" /> : <><Text style={styles.startText}>Commencer {mode === 'sprint' ? 'le sprint' : 'le tempo'}</Text><Ionicons color="#fff" name="arrow-forward" size={21} /></>}
        </Pressable>
      </View>
    </ScrollView>
    <ModeHelpModal open={modeHelpOpen} selectedMode={mode} onClose={() => setModeHelpOpen(false)} />
  </SafeAreaView>;
}

function paramValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function ChoiceRow({ label, onHelp, children }: { label: string; onHelp?: () => void; children: ReactNode }) {
  return <View style={styles.choiceGroup}>
    <View style={styles.rowLabel}>
      <Text style={styles.label}>{label}</Text>
      {onHelp ? <Pressable accessibilityLabel="Informations détaillées sur les modes de jeu" accessibilityRole="button" hitSlop={8} onPress={onHelp} style={({ pressed }) => [styles.help, pressed && styles.pressed]}><Text style={styles.helpText}>?</Text></Pressable> : null}
    </View>
    <View style={styles.choices}>{children}</View>
  </View>;
}

function Segment({ label, detail, active, onPress }: { label: string; detail: string; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.segment, active && styles.active]}>
    <Text style={[styles.optionText, active && styles.activeText]}>{label}</Text>
    <Text numberOfLines={1} style={[styles.segmentDetail, active && styles.activeDetail]}>{detail}</Text>
  </Pressable>;
}

function Pill({ label, active, onPress, dotted, mixed, layout }: {
  label: string;
  active: boolean;
  onPress: () => void;
  dotted?: boolean;
  mixed?: boolean;
  layout: 'third' | 'operation' | 'half';
}) {
  return <Pressable accessibilityLabel={mixed ? 'Mixte, toutes les opérations' : label} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.pill, styles[layout], active && styles.active]}>
    {dotted ? <Text style={[styles.dots, active && styles.activeText]}>•••</Text> : null}
    {mixed ? <MixedOperationIcon active={active} /> : <Text numberOfLines={1} style={[styles.optionText, layout === 'operation' && styles.operationText, active && styles.activeText]}>{label}</Text>}
  </Pressable>;
}

function MixedOperationIcon({ active }: { active: boolean }) {
  const color = active ? '#fff' : '#173246';
  return <View style={[styles.mixedGrid, active && styles.mixedGridActive]}>
    {['+', '−', '×', '÷'].map((operator, index) => <View key={operator} style={[styles.mixedCell, index % 2 === 0 && styles.mixedCellRight, index < 2 && styles.mixedCellBottom]}><Text style={[styles.mixedOperator, { color }]}>{operator}</Text></View>)}
  </View>;
}

function ModeHelpModal({ open, selectedMode, onClose }: { open: boolean; selectedMode: GameMode; onClose: () => void }) {
  return <Modal animationType="fade" onRequestClose={onClose} transparent visible={open}>
    <Pressable accessibilityRole="none" onPress={onClose} style={styles.modalBackdrop}>
      <Pressable accessibilityRole="none" onPress={() => undefined} style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <View><Text style={styles.modalEyebrow}>MODES DE JEU</Text><Text style={styles.modalTitle}>Sprint ou Tempo ?</Text></View>
          <Pressable accessibilityLabel="Fermer" hitSlop={8} onPress={onClose} style={styles.modalClose}><Ionicons color="#173246" name="close" size={23} /></Pressable>
        </View>
        <View style={[styles.modeExplanation, selectedMode === 'sprint' && styles.modeExplanationActive]}>
          <View style={styles.modeExplanationIcon}><Ionicons color="#0b9f8f" name="flash" size={21} /></View>
          <View style={styles.modeExplanationCopy}><Text style={styles.modeExplanationTitle}>Sprint · contre la montre</Text><Text style={styles.modeExplanationText}>Tu disposes de 60, 90 ou 120 secondes. Réponds correctement au plus grand nombre de calculs avant la fin du chrono.</Text></View>
        </View>
        <View style={[styles.modeExplanation, selectedMode === 'tempo' && styles.modeExplanationActive]}>
          <View style={styles.modeExplanationIcon}><Ionicons color="#0b9f8f" name="hourglass-outline" size={21} /></View>
          <View style={styles.modeExplanationCopy}><Text style={styles.modeExplanationTitle}>Tempo · question par question</Text><Text style={styles.modeExplanationText}>Chaque calcul possède son propre chrono. La partie se termine lorsque le nombre de questions choisi est atteint.</Text></View>
        </View>
        <View style={styles.modalTip}><Ionicons color="#7b5d21" name="information-circle-outline" size={19} /><Text style={styles.modalTipText}>Pour valider un objectif du jour, respecte aussi son mode, son niveau, son opération et sa configuration.</Text></View>
        <Pressable onPress={onClose} style={styles.modalDone}><Text style={styles.modalDoneText}>C’est compris</Text></Pressable>
      </Pressable>
    </Pressable>
  </Modal>;
}

function Stepper({ label, value, min, max, step, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return <View style={styles.stepper}>
    <Text style={styles.stepperLabel}>{label}</Text>
    <View style={styles.stepperControl}>
      <Pressable accessibilityLabel={`Diminuer ${label.toLowerCase()}`} disabled={value <= min} onPress={() => onChange(Math.max(min, value - step))} style={[styles.stepperButton, value <= min && styles.disabled]}><Ionicons color="#173246" name="remove" size={18} /></Pressable>
      <Text style={styles.stepperValue}>{value}</Text>
      <Pressable accessibilityLabel={`Augmenter ${label.toLowerCase()}`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + step))} style={[styles.stepperButton, value >= max && styles.disabled]}><Ionicons color="#173246" name="add" size={18} /></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f3f8f7' },
  content: { paddingBottom: 18 },
  profileContent: { flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 13 },
  centerText: { color: '#546b78', fontSize: 14 },
  heading: { alignItems: 'center', paddingBottom: 10, paddingTop: 14 },
  eyebrow: { color: '#0b9f8f', fontSize: 10, fontWeight: '900', letterSpacing: 3 },
  title: { color: '#0f283c', fontSize: 35, fontWeight: '900', lineHeight: 41, marginTop: 1 },
  panel: { backgroundColor: '#fff', borderColor: '#cce4e4', borderRadius: 20, borderWidth: 1, gap: 10, marginHorizontal: 8, padding: 12 },
  choiceGroup: { gap: 6 },
  rowLabel: { alignItems: 'center', flexDirection: 'row', gap: 7, minHeight: 20 },
  label: { color: '#263a4e', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  help: { alignItems: 'center', backgroundColor: '#e9faf7', borderColor: '#b8e9e3', borderRadius: 9, borderWidth: 1, height: 18, justifyContent: 'center', width: 18 },
  helpText: { color: '#0b9f8f', fontSize: 11, fontWeight: '900' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  segment: { alignItems: 'center', backgroundColor: '#f8fbfb', borderColor: '#cfe4e6', borderRadius: 14, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 47, paddingHorizontal: 8 },
  segmentDetail: { color: '#788a94', fontSize: 8, fontWeight: '600', marginTop: 1 },
  activeDetail: { color: '#dcf7f2' },
  pill: { alignItems: 'center', backgroundColor: '#f8fbfb', borderColor: '#cfe4e6', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 5, height: 38, justifyContent: 'center', paddingHorizontal: 8 },
  third: { flexBasis: 0, flexGrow: 1 },
  operation: { flexBasis: 0, flexGrow: 1, minWidth: 42, paddingHorizontal: 3 },
  half: { flexBasis: '47%', flexGrow: 1 },
  active: { backgroundColor: '#0b9f8f', borderColor: '#0b9f8f', shadowColor: '#08766c', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.14, shadowRadius: 6 },
  optionText: { color: '#24394c', fontSize: 11, fontWeight: '900' },
  operationText: { fontSize: 13 },
  activeText: { color: '#fff' },
  dots: { color: '#45bbb0', fontSize: 11, letterSpacing: 0 },
  mixedGrid: { borderColor: '#173246', borderRadius: 3, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', height: 24, overflow: 'hidden', width: 28 },
  mixedGridActive: { borderColor: '#fff' },
  mixedCell: { alignItems: 'center', height: '50%', justifyContent: 'center', width: '50%' },
  mixedCellRight: { borderRightColor: '#8aa0aa', borderRightWidth: StyleSheet.hairlineWidth },
  mixedCellBottom: { borderBottomColor: '#8aa0aa', borderBottomWidth: StyleSheet.hairlineWidth },
  mixedOperator: { fontSize: 7, fontWeight: '900', lineHeight: 9 },
  tempoSettings: { flexDirection: 'row', gap: 8 },
  stepper: { backgroundColor: '#f8fbfb', borderColor: '#d4e7e8', borderRadius: 13, borderWidth: 1, flex: 1, padding: 8 },
  stepperLabel: { color: '#435968', fontSize: 8, fontWeight: '900', letterSpacing: 0.7, marginBottom: 5, textAlign: 'center' },
  stepperControl: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  stepperButton: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#d1e3e5', borderRadius: 10, borderWidth: 1, height: 30, justifyContent: 'center', width: 30 },
  stepperValue: { color: '#102a3e', fontSize: 15, fontWeight: '900', minWidth: 28, textAlign: 'center' },
  noticeBox: { backgroundColor: '#eaf8f5', borderRadius: 11, flexDirection: 'row', gap: 7, padding: 9 },
  noticeText: { color: '#087f73', flex: 1, fontSize: 11, lineHeight: 16 },
  errorBox: { backgroundColor: '#fff0ee', borderRadius: 11, flexDirection: 'row', gap: 8, padding: 9 },
  errorText: { color: '#8e332d', flex: 1, fontSize: 11, lineHeight: 16 },
  startButton: { alignItems: 'center', backgroundColor: '#0b9f8f', borderRadius: 14, flexDirection: 'row', gap: 14, height: 50, justifyContent: 'center', marginTop: 1 },
  startText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  pressed: { opacity: 0.84 },
  disabled: { opacity: 0.55 },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(5, 20, 31, 0.58)', flex: 1, justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#fff', borderRadius: 22, gap: 12, maxWidth: 430, padding: 18, width: '100%' },
  modalHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  modalEyebrow: { color: '#0b9f8f', fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
  modalTitle: { color: '#102a3e', fontSize: 23, fontWeight: '900', marginTop: 2 },
  modalClose: { alignItems: 'center', backgroundColor: '#eef5f4', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  modeExplanation: { borderColor: '#dbe9e8', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 12 },
  modeExplanationActive: { backgroundColor: '#effaf7', borderColor: '#8dd2c7' },
  modeExplanationIcon: { alignItems: 'center', backgroundColor: '#e5f7f3', borderRadius: 12, height: 40, justifyContent: 'center', width: 40 },
  modeExplanationCopy: { flex: 1 },
  modeExplanationTitle: { color: '#173246', fontSize: 14, fontWeight: '900' },
  modeExplanationText: { color: '#566e79', fontSize: 12, lineHeight: 17, marginTop: 3 },
  modalTip: { backgroundColor: '#fff8e8', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 },
  modalTipText: { color: '#6f5625', flex: 1, fontSize: 11, lineHeight: 16 },
  modalDone: { alignItems: 'center', backgroundColor: '#0b9f8f', borderRadius: 13, justifyContent: 'center', minHeight: 46 },
  modalDoneText: { color: '#fff', fontSize: 14, fontWeight: '900' },
});
