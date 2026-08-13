import { Ionicons } from '@expo/vector-icons';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { startSoloRun, type SoloRun, type SoloRunAnswer, type TokenProvider } from '@/lib/api';
import { SOLO_PLAY_ROUTE } from '@/lib/playNavigation';
import { formatResponseTime, getPlayerLevelFromXp, getSoloResultSummary, getSoloResultTitle, getSoloXpJourney } from '@/lib/soloResult';

type SoloResultScreenProps = {
  getToken: TokenProvider;
  run: SoloRun;
};

type ScorePhase = 'session' | 'mission' | 'done';

const FIREWORK_PARTICLES = Array.from({ length: 18 }, (_, index) => {
  const angle = (index / 18) * Math.PI * 2;
  const distance = 46 + (index % 3) * 13;
  return {
    colorIndex: index % 5,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
  };
});

const FIREWORK_COLORS = ['#0aa493', '#48c7b7', '#ffc94a', '#ff8f70', '#6558d3'];
const SCORE_ANIMATION_DELAY_MS = 320;
const SCORE_ANIMATION_DURATION_MS = 3_000;

export function SoloResultScreen({ getToken, run }: SoloResultScreenProps) {
  const [answersOpen, setAnswersOpen] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const summary = useMemo(() => getSoloResultSummary(run), [run]);
  const journey = useMemo(() => getSoloXpJourney(run.result, run.progress.xp), [run.progress.xp, run.result]);
  const completedMissions = run.result?.completedMissions ?? [];

  const replay = async () => {
    setReplaying(true);
    setReplayError(null);

    try {
      const nextRun = await startSoloRun(getToken, {
        clientRunId: Crypto.randomUUID(),
        mode: run.mode,
        game: run.game,
        level: run.level,
        practiceSkill: null,
        sprintDurationSeconds: run.durationSeconds as 60 | 90 | 120,
        tempoQuestionCount: run.questionCount,
        tempoQuestionSeconds: run.perQuestionTimeLimitSeconds ?? 10,
      });
      router.replace({ pathname: '/game/[runId]', params: { runId: nextRun.id } });
    } catch (reason) {
      setReplayError(reason instanceof Error ? reason.message : 'Impossible de relancer la partie.');
      setReplaying(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View pointerEvents="none" style={styles.auraMint} />
      <View pointerEvents="none" style={styles.auraGold} />

      <ScrollView
        contentContainerStyle={[styles.content, !answersOpen && styles.contentCentered]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.resultIcon}>
            <Ionicons color="#0b9d8e" name="trophy-outline" size={34} />
          </View>
          <Text style={styles.eyebrow}>PARTIE TERMINÉE</Text>
          <Text style={styles.title}>{getSoloResultTitle(summary.accuracy, summary.totalAnswers)}</Text>
          <View style={styles.accuracyPill}>
            <Ionicons color="#087f73" name="analytics-outline" size={16} />
            <Text style={styles.accuracyText}>{summary.accuracy}% de réponses justes</Text>
          </View>
        </View>

        <XpCelebration
          level={run.result?.playerProgress?.level ?? null}
          missionXp={journey.missionXp}
          sessionXp={journey.sessionXp}
          totalAfter={journey.totalAfter}
          totalBefore={journey.totalBefore}
        />

        <View style={styles.metricGrid}>
          <MetricCard
            icon="checkmark-circle-outline"
            label="Bonnes réponses"
            value={`${summary.correctAnswers}/${summary.totalAnswers}`}
          />
          <MetricCard divided icon="flame-outline" label="Meilleure série" value={String(summary.bestStreak)} />
          <MetricCard divided icon="stopwatch-outline" label="Temps moyen" value={formatResponseTime(summary.averageResponseTimeMs)} />
          <MetricCard divided icon="star-outline" label="Points" value={String(summary.scorePoints)} />
        </View>

        {completedMissions.length ? (
          <MissionRewards missions={completedMissions} sessionXp={journey.sessionXp} />
        ) : null}

        <View style={styles.answersCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: answersOpen }}
            onPress={() => setAnswersOpen((current) => !current)}
            style={({ pressed }) => [styles.answersToggle, pressed && styles.pressed]}
          >
            <View style={styles.answersToggleIcon}>
              <Ionicons color="#087f73" name="list-outline" size={21} />
            </View>
            <View style={styles.answersToggleCopy}>
              <Text style={styles.answersToggleTitle}>
                {"Réponses"}
              </Text>
              <Text style={styles.answersToggleSubtitle}>
                {summary.totalAnswers} réponse{summary.totalAnswers === 1 ? '' : 's'} enregistrée{summary.totalAnswers === 1 ? '' : 's'}
              </Text>
            </View>
            <Ionicons color="#58717c" name={answersOpen ? 'chevron-up' : 'chevron-down'} size={20} />
          </Pressable>

          {answersOpen ? (
            <View style={styles.answersList}>
              {run.answers.length ? run.answers.map((answer, index) => (
                <AnswerRow answer={answer} isLast={index === run.answers.length - 1} key={answer.questionIndex} />
              )) : (
                <Text style={styles.emptyAnswers}>Aucune réponse n’a été enregistrée pendant cette partie.</Text>
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {replayError ? <Text style={styles.error}>{replayError}</Text> : null}
        <View style={styles.actions}>
          <Pressable
            disabled={replaying}
            onPress={() => void replay()}
            style={({ pressed }) => [styles.primaryButton, (pressed || replaying) && styles.buttonPressed]}
          >
            {replaying ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons color="#fff" name="refresh" size={19} />
            )}
            <Text style={styles.primaryButtonText}>Rejouer</Text>
          </Pressable>
          <Pressable
            disabled={replaying}
            onPress={() => router.replace(SOLO_PLAY_ROUTE)}
            style={({ pressed }) => [styles.menuButton, (pressed || replaying) && styles.buttonPressed]}
          >
            <Ionicons color="#173246" name="menu-outline" size={20} />
            <Text style={styles.menuButtonText}>Menu</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function XpCelebration({
  level,
  missionXp,
  sessionXp,
  totalAfter,
  totalBefore,
}: {
  level: number | null;
  missionXp: number;
  sessionXp: number;
  totalAfter: number;
  totalBefore: number;
}) {
  const counter = useRef(new Animated.Value(totalBefore)).current;
  const loading = useRef(new Animated.Value(0)).current;
  const [displayedXp, setDisplayedXp] = useState(totalBefore);
  const [phase, setPhase] = useState<ScorePhase>(sessionXp > 0 ? 'session' : missionXp > 0 ? 'mission' : 'done');
  const [burstTrigger, setBurstTrigger] = useState(0);
  const startingLevel = getPlayerLevelFromXp(totalBefore);
  const displayedLevel = getPlayerLevelFromXp(displayedXp);
  const attainedLevel = level ?? getPlayerLevelFromXp(totalAfter);

  useEffect(() => {
    let active = true;
    let currentAnimation: Animated.CompositeAnimation | null = null;
    const listener = counter.addListener(({ value }) => setDisplayedXp(Math.round(value)));

    counter.setValue(totalBefore);
    loading.setValue(0);
    setDisplayedXp(totalBefore);

    const animateTo = (target: number, onComplete: () => void) => {
      loading.setValue(0);
      currentAnimation = Animated.sequence([
        Animated.delay(SCORE_ANIMATION_DELAY_MS),
        Animated.parallel([
          Animated.timing(counter, {
            duration: SCORE_ANIMATION_DURATION_MS,
            easing: Easing.out(Easing.cubic),
            toValue: target,
            useNativeDriver: false,
          }),
          Animated.timing(loading, {
            duration: SCORE_ANIMATION_DURATION_MS,
            easing: Easing.out(Easing.cubic),
            toValue: 1,
            useNativeDriver: false,
          }),
        ]),
      ]);
      currentAnimation.start(({ finished }) => {
        if (finished && active) onComplete();
      });
    };

    const animateMissionXp = () => {
      if (missionXp <= 0) {
        setPhase('done');
        return;
      }

      setPhase('mission');
      animateTo(totalAfter, () => {
        setBurstTrigger((current) => current + 1);
        setPhase('done');
      });
    };

    if (sessionXp > 0) {
      setPhase('session');
      animateTo(totalBefore + sessionXp, () => {
        setBurstTrigger((current) => current + 1);
        animateMissionXp();
      });
    } else if (missionXp > 0) {
      animateMissionXp();
    } else {
      counter.setValue(totalAfter);
      loading.setValue(1);
      setPhase('done');
    }

    return () => {
      active = false;
      currentAnimation?.stop();
      counter.removeListener(listener);
    };
  }, [counter, loading, missionXp, sessionXp, totalAfter, totalBefore]);

  const phaseText = phase === 'session'
    ? `+${sessionXp} XP gagnés pendant la partie`
    : phase === 'mission'
      ? `+${missionXp} XP grâce aux missions`
      : sessionXp + missionXp > 0
        ? `+${sessionXp + missionXp} XP ajoutés au total`
        : 'Ton total XP reste inchangé';

  return (
    <View style={[styles.xpSection, phase === 'mission' && styles.xpSectionMission]}>
      <FireworkBurst missionTone={phase === 'mission' || (phase === 'done' && missionXp > 0)} trigger={burstTrigger} />
      <Text style={styles.xpEyebrow}>PROGRESSION XP</Text>
      <View style={styles.xpJourney}>
        <View style={styles.xpEndpoint}>
          <Text style={styles.xpEndpointValue}>{totalBefore}<Text style={styles.xpEndpointUnit}> XP</Text></Text>
          <Text style={styles.xpEndpointLevel}>Niv. {startingLevel}</Text>
        </View>
        <View style={styles.xpConnector}>
          <View style={styles.loadingTrack}>
            <Animated.View
              style={[
                styles.loadingFill,
                phase === 'mission' && styles.loadingFillMission,
                { width: loading.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
              ]}
            />
          </View>
        </View>
        <View style={[styles.xpEndpoint, styles.xpEndpointRight]}>
          <Text accessibilityLiveRegion="polite" style={styles.xpEndpointValue}>{displayedXp}<Text style={styles.xpEndpointUnit}> XP</Text></Text>
          <Text style={[styles.xpEndpointLevel, displayedLevel === attainedLevel && styles.xpEndpointLevelReached]}>
            Niv. {displayedLevel}
          </Text>
        </View>
      </View>
      <View style={styles.phaseLine}>
        <Ionicons
          color={phase === 'mission' ? '#b47a09' : '#087f73'}
          name={phase === 'mission' ? 'sparkles' : 'flash-outline'}
          size={16}
        />
        <Text style={[styles.phaseText, phase === 'mission' && styles.phaseTextMission]}>{phaseText}</Text>
      </View>
    </View>
  );
}

function FireworkBurst({ missionTone, trigger }: { missionTone: boolean; trigger: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (trigger === 0) return;
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      duration: 900,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, trigger]);

  return (
    <View pointerEvents="none" style={styles.fireworkLayer}>
      {FIREWORK_PARTICLES.map((particle, index) => (
        <Animated.View
          key={`${index}:${particle.x}:${particle.y}`}
          style={[
            styles.fireworkParticle,
            { backgroundColor: missionTone ? FIREWORK_COLORS[(particle.colorIndex + 2) % FIREWORK_COLORS.length] : FIREWORK_COLORS[particle.colorIndex] },
            {
              opacity: progress.interpolate({ inputRange: [0, 0.12, 0.72, 1], outputRange: [0, 1, 0.9, 0] }),
              transform: [
                { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.x] }) },
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, particle.y] }) },
                { scale: progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.2, 1.35, 0.45] }) },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

function MetricCard({ divided = false, icon, label, value }: { divided?: boolean; icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={[styles.metricItem, divided && styles.metricDivider]}>
      <View style={styles.metricHeadline}>
        <View style={styles.metricIcon}>
          <Ionicons color="#0a9587" name={icon} size={16} />
        </View>
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.metricValue}>{value}</Text>
      </View>
      <Text numberOfLines={2} style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function MissionRewards({
  missions,
  sessionXp,
}: {
  missions: NonNullable<SoloRun['result']>['completedMissions'];
  sessionXp: number;
}) {
  const reveal = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.delay(sessionXp > 0 ? SCORE_ANIMATION_DELAY_MS + SCORE_ANIMATION_DURATION_MS + 180 : 420),
      Animated.spring(reveal, { damping: 11, stiffness: 150, toValue: 1, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [reveal, sessionXp]);

  return (
    <Animated.View
      style={[
        styles.missionCard,
        {
          opacity: reveal,
          transform: [
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
            { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      <View style={styles.missionHeader}>
        <View style={styles.missionIcon}>
          <Ionicons color="#a66d00" name="sparkles" size={21} />
        </View>
        <View style={styles.missionHeaderCopy}>
          <Text style={styles.missionEyebrow}>BONUS DÉBLOQUÉ</Text>
          <Text style={styles.missionTitle}>Mission{missions.length > 1 ? 's' : ''} accomplie{missions.length > 1 ? 's' : ''} !</Text>
        </View>
      </View>
      {missions.map((mission) => (
        <View key={mission.key} style={styles.missionRow}>
          <Ionicons color="#a66d00" name="ribbon-outline" size={18} />
          <Text style={styles.missionName}>{mission.title}</Text>
          <Text style={styles.missionReward}>+{mission.rewardXp} XP</Text>
        </View>
      ))}
    </Animated.View>
  );
}

function AnswerRow({ answer, isLast }: { answer: SoloRunAnswer; isLast: boolean }) {
  return (
    <View style={[styles.answerRow, isLast && styles.answerRowLast]}>
      <View style={styles.answerTopLine}>
        <Text style={styles.answerNumber}>Question {answer.questionIndex + 1}</Text>
        <View style={styles.answerTime}>
          <Ionicons color="#607681" name="time-outline" size={14} />
          <Text style={styles.answerTimeText}>{formatResponseTime(answer.responseTimeMs)}</Text>
        </View>
      </View>
      <View style={styles.answerMainLine}>
        <Text numberOfLines={1} adjustsFontSizeToFit style={styles.answerPrompt}>{answer.prompt}</Text>
        <View style={styles.answerGiven}>
          <Text style={styles.answerGivenLabel}>Ta réponse</Text>
          <Text style={[styles.answerGivenValue, !answer.isCorrect && styles.answerValueWrong]}>{answer.userAnswer ?? 'Aucune'}</Text>
        </View>
      </View>
      <View style={styles.answerBottomLine}>
        <Text style={styles.answerExpected}>Réponse attendue <Text style={styles.answerExpectedValue}>{answer.correctAnswer}</Text></Text>
        <View style={[styles.answerStatePill, answer.isCorrect ? styles.answerStateValid : styles.answerStateFailed]}>
          <Ionicons
            color={answer.isCorrect ? '#087f73' : '#b43a32'}
            name={answer.isCorrect ? 'checkmark-circle' : 'close-circle'}
            size={14}
          />
          <Text style={[styles.answerStateText, answer.isCorrect ? styles.answerStateTextValid : styles.answerStateTextFailed]}>
            {answer.isCorrect ? 'Validé' : 'Échoué'}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5faf9', overflow: 'hidden' },
  auraMint: { position: 'absolute', width: 310, height: 310, borderRadius: 155, backgroundColor: '#dff8f3', opacity: 0.58, top: 145, right: -145 },
  auraGold: { position: 'absolute', width: 270, height: 270, borderRadius: 135, backgroundColor: '#fff7d9', opacity: 0.46, top: 270, left: -150 },
  content: { alignSelf: 'center', flexGrow: 1, maxWidth: 520, paddingBottom: 18, paddingHorizontal: 14, paddingTop: 10, width: '100%' },
  contentCentered: { justifyContent: 'center' },
  hero: { alignItems: 'center', paddingBottom: 13, paddingHorizontal: 10 },
  resultIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(224,248,243,0.94)', borderWidth: 1, borderColor: '#bde9e1', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  eyebrow: { color: '#0a9587', fontSize: 10, fontWeight: '900', letterSpacing: 2.8 },
  title: { color: '#102a3e', fontSize: 27, lineHeight: 33, fontWeight: '900', textAlign: 'center', marginTop: 4 },
  accuracyPill: { alignItems: 'center', backgroundColor: 'rgba(219,245,239,0.78)', borderRadius: 999, flexDirection: 'row', gap: 5, marginTop: 7, paddingHorizontal: 11, paddingVertical: 5 },
  accuracyText: { color: '#087f73', fontSize: 11, fontWeight: '800' },
  xpSection: { borderBottomColor: '#cfe3e0', borderBottomWidth: 1, borderTopColor: '#cfe3e0', borderTopWidth: 1, paddingHorizontal: 2, paddingVertical: 11, position: 'relative' },
  xpSectionMission: { borderBottomColor: '#e3c96f', borderTopColor: '#e3c96f' },
  xpEyebrow: { color: '#0a9587', fontSize: 8, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  xpJourney: { alignItems: 'center', flexDirection: 'row', marginTop: 9 },
  xpEndpoint: { width: 70 },
  xpEndpointRight: { alignItems: 'flex-end' },
  xpEndpointValue: { color: '#102a3e', fontSize: 15, fontWeight: '900', letterSpacing: -0.3 },
  xpEndpointUnit: { color: '#657a84', fontSize: 9, fontWeight: '900', letterSpacing: 0 },
  xpEndpointLevel: { color: '#6c818a', fontSize: 9, fontWeight: '800', marginTop: 2 },
  xpEndpointLevelReached: { color: '#087f73' },
  xpConnector: { flex: 1, marginHorizontal: 8 },
  loadingTrack: { backgroundColor: '#d7e6e4', borderRadius: 999, height: 7, overflow: 'hidden' },
  loadingFill: { backgroundColor: '#0aa493', borderRadius: 999, height: '100%' },
  loadingFillMission: { backgroundColor: '#efb82e' },
  phaseLine: { alignItems: 'center', flexDirection: 'row', gap: 5, justifyContent: 'center', marginTop: 8 },
  phaseText: { color: '#087f73', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  phaseTextMission: { color: '#9a6604' },
  fireworkLayer: { bottom: 0, left: 0, position: 'absolute', right: 0, top: 0 },
  fireworkParticle: { borderRadius: 4, height: 6, left: '50%', position: 'absolute', top: '56%', width: 6 },
  metricGrid: { borderBottomColor: '#cfe3e0', borderBottomWidth: 1, flexDirection: 'row', marginTop: 15, paddingBottom: 13, paddingTop: 2 },
  metricItem: { alignItems: 'center', flex: 1, minWidth: 0, paddingHorizontal: 4 },
  metricDivider: { borderLeftColor: '#d5e5e3', borderLeftWidth: 1 },
  metricHeadline: { alignItems: 'center', flexDirection: 'row', gap: 4, justifyContent: 'center' },
  metricIcon: { alignItems: 'center', backgroundColor: '#dff5f0', borderRadius: 12, height: 24, justifyContent: 'center', width: 24 },
  metricLabel: { color: '#627983', fontSize: 9, fontWeight: '700', lineHeight: 12, marginTop: 6, minHeight: 24, textAlign: 'center' },
  metricValue: { color: '#102a3e', flexShrink: 1, fontSize: 17, fontWeight: '900' },
  missionCard: { backgroundColor: 'rgba(255,248,219,0.88)', borderColor: '#ebd184', borderRadius: 16, borderWidth: 1, marginTop: 14, padding: 12 },
  missionHeader: { alignItems: 'center', flexDirection: 'row', gap: 10 },
  missionIcon: { alignItems: 'center', backgroundColor: '#ffedaa', borderRadius: 18, height: 36, justifyContent: 'center', width: 36 },
  missionHeaderCopy: { flex: 1 },
  missionEyebrow: { color: '#a66d00', fontSize: 8, fontWeight: '900', letterSpacing: 1.7 },
  missionTitle: { color: '#5d430d', fontSize: 17, fontWeight: '900', marginTop: 2 },
  missionRow: { alignItems: 'center', borderTopColor: 'rgba(183,132,23,0.2)', borderTopWidth: 1, flexDirection: 'row', gap: 8, marginTop: 11, paddingTop: 11 },
  missionName: { color: '#644b18', flex: 1, fontSize: 12, fontWeight: '800' },
  missionReward: { color: '#986300', fontSize: 12, fontWeight: '900' },
  answersCard: { borderBottomColor: '#cfe3e0', borderBottomWidth: 1, borderTopColor: '#cfe3e0', borderTopWidth: 1, marginTop: 15, overflow: 'hidden' },
  answersToggle: { alignItems: 'center', flexDirection: 'row', gap: 9, minHeight: 58, paddingHorizontal: 2, paddingVertical: 9 },
  pressed: { backgroundColor: 'rgba(224,245,241,0.55)' },
  answersToggleIcon: { alignItems: 'center', backgroundColor: '#dff5f0', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  answersToggleCopy: { flex: 1 },
  answersToggleTitle: { color: '#173246', fontSize: 14, fontWeight: '900' },
  answersToggleSubtitle: { color: '#71848d', fontSize: 10, fontWeight: '700', marginTop: 3 },
  answersList: { borderTopColor: '#deebea', borderTopWidth: 1 },
  emptyAnswers: { color: '#6c818b', fontSize: 12, lineHeight: 18, padding: 8, textAlign: 'center' },
  answerRow: { borderBottomColor: '#d7e7e4', borderBottomWidth: 1, paddingHorizontal: 2, paddingVertical: 11 },
  answerRowLast: { borderBottomWidth: 0 },
  answerTopLine: { alignItems: 'center', flexDirection: 'row' },
  answerNumber: { color: '#617781', flex: 1, fontSize: 10, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  answerTime: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: 3, paddingHorizontal: 3, paddingVertical: 4 },
  answerTimeText: { color: '#607681', fontSize: 10, fontWeight: '800' },
  answerMainLine: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 5 },
  answerPrompt: { color: '#102a3e', flex: 1, fontSize: 22, fontWeight: '900' },
  answerGiven: { alignItems: 'baseline', flexDirection: 'row', gap: 5 },
  answerGivenLabel: { color: '#6a7f88', fontSize: 9, fontWeight: '700' },
  answerGivenValue: { color: '#102a3e', fontSize: 18, fontWeight: '900' },
  answerValueWrong: { color: '#b43a32' },
  answerBottomLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 },
  answerExpected: { color: '#6a7f88', flex: 1, fontSize: 10, fontWeight: '700' },
  answerExpectedValue: { color: '#102a3e', fontSize: 11, fontWeight: '900' },
  answerStatePill: { alignItems: 'center', borderRadius: 999, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 4 },
  answerStateValid: { backgroundColor: '#d9f2ec' },
  answerStateFailed: { backgroundColor: '#f9dfdb' },
  answerStateText: { fontSize: 9, fontWeight: '900' },
  answerStateTextValid: { color: '#087f73' },
  answerStateTextFailed: { color: '#b43a32' },
  footer: { backgroundColor: 'rgba(245,250,249,0.97)', borderTopColor: '#d5e6e4', borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 9 },
  error: { color: '#a43a32', fontSize: 11, fontWeight: '700', marginBottom: 7, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  primaryButton: { alignItems: 'center', backgroundColor: '#0aa493', borderRadius: 15, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50 },
  primaryButtonText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  menuButton: { alignItems: 'center', backgroundColor: 'transparent', borderColor: '#bad6d2', borderRadius: 15, borderWidth: 1, flex: 1, flexDirection: 'row', gap: 8, justifyContent: 'center', minHeight: 50 },
  menuButtonText: { color: '#173246', fontSize: 14, fontWeight: '900' },
  buttonPressed: { opacity: 0.55 },
});
