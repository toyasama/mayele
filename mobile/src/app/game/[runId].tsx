import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NumericKeypad } from '@/components/NumericKeypad';
import { SoloResultScreen } from '@/components/SoloResultScreen';
import { finishSoloRun, getSoloRun, type SoloRun, type SoloRunAnswer, submitSoloAnswer } from '@/lib/api';
import { SOLO_PLAY_ROUTE } from '@/lib/playNavigation';
import { useStableToken } from '@/hooks/useStableToken';

export default function GameArena() {
  const { runId } = useLocalSearchParams<{ runId: string }>();
  const getToken = useStableToken();
  const [run, setRun] = useState<SoloRun | null>(null);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [remaining, setRemaining] = useState(-1);
  const [feedbacks, setFeedbacks] = useState<{ id: string; answer: SoloRunAnswer; streak: number }[]>([]);
  const [questionPreview, setQuestionPreview] = useState<SoloRun['nextQuestion']>(null);
  const [error, setError] = useState<string | null>(null);
  const finishingRef = useRef(false);
  const submittingRef = useRef(false);
  const timedOutQuestionRef = useRef<number | null>(null);
  const answerInputRef = useRef<TextInput>(null);

  const showFeedback = useCallback((nextAnswer: SoloRunAnswer, streak: number) => {
    const id = `${nextAnswer.questionIndex}:${nextAnswer.userAnswer ?? 'timeout'}`;
    setFeedbacks((current) => current.some((item) => item.id === id)
      ? current
      : [...current, { id, answer: nextAnswer, streak }].slice(-3));
  }, []);
  const dismissFeedback = useCallback((id: string) => setFeedbacks((current) => current.filter((item) => item.id !== id)), []);

  useEffect(() => { void getSoloRun(getToken, runId).then(setRun).catch((reason) => setError(reason instanceof Error ? reason.message : 'Partie introuvable.')); }, [getToken, runId]);
  useEffect(() => {
    if (!run || run.status !== 'active') return;
    const target = new Date(run.mode === 'tempo' && run.question ? run.question.deadlineAt : run.endsAt).getTime();
    const serverOffset = new Date(run.serverNow).getTime() - Date.now();
    const update = () => setRemaining(Math.max(0, Math.ceil((target - (Date.now() + serverOffset)) / 1000)));
    update(); const timer = setInterval(update, 250); return () => clearInterval(timer);
  }, [run]);

  const finish = useCallback(async () => {
    if (!run || finishingRef.current || run.status !== 'active') return;
    finishingRef.current = true; setBusy(true);
    try { setRun(await finishSoloRun(getToken, run.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible de terminer la partie.'); finishingRef.current = false; }
    finally { setBusy(false); }
  }, [getToken, run]);

  const submit = useCallback(async (forcedAnswer?: number | null) => {
    if (!run?.question || submittingRef.current) return;
    const submittedAnswer = answer;
    const parsed = forcedAnswer !== undefined ? forcedAnswer : (submittedAnswer.trim() === '' ? null : Number(submittedAnswer));
    if (forcedAnswer === undefined && (parsed === null || !Number.isInteger(parsed))) return setError('Entre un nombre entier.');
    const submittedQuestion = run.question;
    submittingRef.current = true;
    setBusy(true); setError(null);
    setAnswer('');
    setQuestionPreview(run.nextQuestion);
    try {
      const response = await submitSoloAnswer(getToken, run.id, submittedQuestion.index, parsed);
      if (response.correction) showFeedback(response.correction, response.run.progress.currentStreak);
      setQuestionPreview(null); setRun(response.run);
      requestAnimationFrame(() => answerInputRef.current?.focus());
      if (response.run.status === 'active' && !response.run.question) setRun(await finishSoloRun(getToken, response.run.id));
    } catch (reason) {
      try {
        const latestRun = await getSoloRun(getToken, run.id);
        const storedCorrection = latestRun.answers.find((item) => item.questionIndex === submittedQuestion.index);
        if (storedCorrection || latestRun.status !== 'active' || latestRun.question?.index !== submittedQuestion.index) {
          setQuestionPreview(null); setRun(latestRun); setAnswer('');
          if (storedCorrection) showFeedback(storedCorrection, latestRun.progress.currentStreak);
        } else {
          setQuestionPreview(null); setRun(latestRun); setAnswer(submittedAnswer);
          setError(reason instanceof Error ? reason.message : 'Réponse non enregistrée. Réessaie.');
        }
      } catch {
        setQuestionPreview(null);
        setAnswer(submittedAnswer);
        setError(reason instanceof Error ? reason.message : 'Réponse non enregistrée. Réessaie.');
      }
    } finally { submittingRef.current = false; setBusy(false); }
  }, [answer, getToken, run, showFeedback]);

  useEffect(() => {
    if (run?.status !== 'active' || remaining !== 0) return;
    if (run.mode === 'tempo' && run.question) {
      if (timedOutQuestionRef.current === run.question.index) return;
      timedOutQuestionRef.current = run.question.index;
      void submit(null);
      return;
    }
    if (run.mode === 'sprint') void finish();
  }, [finish, remaining, run, submit]);

  if (error && !run) return <SafeAreaView style={styles.center}><Ionicons color="#b53a32" name="alert-circle-outline" size={38} /><Text style={styles.error}>{error}</Text><Pressable onPress={() => router.replace(SOLO_PLAY_ROUTE)} style={styles.primary}><Text style={styles.primaryText}>Retour au jeu</Text></Pressable></SafeAreaView>;
  if (!run) return <View style={styles.center}><ActivityIndicator color="#11a696" size="large" /></View>;
  if (run.status !== 'active') return <SoloResultScreen getToken={getToken} run={run} />;

  const displayedRemaining = Math.max(0, remaining);
  const timerTotal = run.mode === 'tempo' ? (run.perQuestionTimeLimitSeconds ?? 10) : run.durationSeconds;
  const elapsed = Math.max(0, timerTotal - displayedRemaining);
  const timerProgress = Math.min(100, Math.max(0, (elapsed / timerTotal) * 100));
  const operationLabel = run.game === 'mixte' ? 'MIXTE' : run.game.toUpperCase();
  const levelLabel = run.level.toUpperCase();
  const displayedQuestion = questionPreview ?? run.question;
  return <SafeAreaView style={styles.safe}>
    <View pointerEvents="none" style={styles.auraMint} /><View pointerEvents="none" style={styles.auraGold} />
    <View style={styles.top}><Pressable disabled={busy} onPress={() => void finish()} style={styles.close}><Ionicons color="#163146" name="close" size={24} /></Pressable><View style={styles.headerCenter}><Text style={styles.mode}>{run.mode === 'sprint' ? 'SPRINT' : 'TEMPO'}</Text><Text style={styles.headerContext}>{operationLabel} · {levelLabel}</Text></View><View style={[styles.timer, displayedRemaining <= 10 && styles.timerCritical]}><Ionicons color={displayedRemaining <= 10 ? '#b43a32' : '#11a696'} name="timer-outline" size={18} /><Text style={[styles.timerText, displayedRemaining <= 10 && styles.timerCriticalText]}>{displayedRemaining}s</Text></View></View>
    <View style={styles.timeBarRow}><View style={styles.timeTrack}><View style={[styles.timeFill, displayedRemaining <= 10 && styles.timeFillCritical, { width: `${timerProgress}%` }]} /></View><Text style={styles.elapsed}>{elapsed}s</Text></View>
    <View style={styles.arena}>
      <View style={styles.gameSummary}>
        <View style={styles.stats}><Stat value={run.progress.correctAnswers} label="Justes" /><Stat value={run.progress.currentStreak} label="Série" /><Stat value={run.progress.scorePoints} label="Score" /></View>
      </View>
      <View style={styles.questionArea}>
        <View pointerEvents="none" style={styles.feedbackStack}>{feedbacks.map((item, index) => <AnswerFeedback id={item.id} key={item.id} answer={item.answer} onDismiss={dismissFeedback} stackIndex={feedbacks.length - 1 - index} streak={item.streak} />)}</View>
        <Text style={styles.question}>{displayedQuestion?.prompt ?? 'Préparation…'}</Text>
        <TextInput ref={answerInputRef} autoFocus caretHidden contextMenuHidden editable={!busy} keyboardType="number-pad" onChangeText={(value) => { setAnswer(value); }} placeholder="Ta réponse" placeholderTextColor="#9aabb3" showSoftInputOnFocus={false} style={styles.input} value={answer} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <NumericKeypad answer={answer} busy={busy} onChange={(value) => { setAnswer(value); setError(null); }} onSubmit={() => void submit()} />
    </View>
  </SafeAreaView>;
}

function Stat({ value, label }: { value: number; label: string }) { return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>; }
function AnswerFeedback({ answer, id, onDismiss, stackIndex, streak }: { answer: SoloRunAnswer; id: string; onDismiss: (id: string) => void; stackIndex: number; streak: number }) {
  const rise = useRef(new Animated.Value(8)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const stackOffset = useRef(new Animated.Value(-stackIndex * 39)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.sequence([
        Animated.timing(opacity, { duration: 130, easing: Easing.out(Easing.quad), toValue: 1, useNativeDriver: true }),
        Animated.delay(2150),
        Animated.timing(opacity, { duration: 700, easing: Easing.in(Easing.quad), toValue: 0, useNativeDriver: true }),
      ]),
      Animated.timing(rise, { duration: 3000, easing: Easing.out(Easing.cubic), toValue: -18, useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onDismiss(id); });
  }, [id, onDismiss, opacity, rise]);
  useEffect(() => {
    Animated.timing(stackOffset, { duration: 180, easing: Easing.out(Easing.cubic), toValue: -stackIndex * 39, useNativeDriver: true }).start();
  }, [stackIndex, stackOffset]);
  return <Animated.View style={[styles.feedbackCard, answer.isCorrect ? styles.feedbackGood : styles.feedbackBad, { bottom: 0, opacity, transform: [{ translateY: Animated.add(rise, stackOffset) }] }]}>
    <View style={styles.feedbackHeading}><Ionicons color={answer.isCorrect ? '#087f73' : '#b43a32'} name={answer.isCorrect ? 'checkmark-circle' : 'close-circle'} size={15} /><Text style={[styles.feedbackTitle, answer.isCorrect ? styles.good : styles.bad]}>{answer.isCorrect ? 'Juste' : 'À reprendre'}</Text><Text numberOfLines={1} style={styles.feedbackPrompt}>{answer.prompt}</Text></View>
    <View style={styles.feedbackValues}><Text style={styles.feedbackValue}>Vous <Text style={styles.feedbackStrong}>{answer.userAnswer ?? '—'}</Text></Text><Text style={styles.feedbackValue}>Attendu <Text style={styles.feedbackStrong}>{answer.correctAnswer}</Text></Text>{answer.isCorrect ? <Text style={styles.feedbackValue}>Série <Text style={styles.feedbackStrong}>×{streak}</Text></Text> : null}</View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f5faf9', overflow: 'hidden' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f8f7', padding: 26, gap: 14 },
  auraMint: { position: 'absolute', width: 310, height: 310, borderRadius: 155, backgroundColor: '#dff8f3', opacity: 0.58, top: 145, right: -145 },
  auraGold: { position: 'absolute', width: 270, height: 270, borderRadius: 135, backgroundColor: '#fff7d9', opacity: 0.46, top: 270, left: -150 },
  top: { height: 72, backgroundColor: 'rgba(255,255,255,0.9)', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 },
  headerCenter: { alignItems: 'center', flex: 1 },
  close: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: '#dce8e8', alignItems: 'center', justifyContent: 'center' },
  mode: { color: '#0a9f8f', fontSize: 11, fontWeight: '900', letterSpacing: 2.3, textAlign: 'center' },
  headerContext: { color: '#536d78', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 4 },
  timer: { minWidth: 66, paddingHorizontal: 10, height: 39, borderRadius: 20, backgroundColor: '#e6f7f3', flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center' },
  timerCritical: { backgroundColor: '#fff0ee' }, timerText: { color: '#0c8479', fontWeight: '900' }, timerCriticalText: { color: '#b43a32' },
  timeBarRow: { backgroundColor: 'rgba(255,255,255,0.9)', borderBottomColor: '#dce9e8', borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 8, paddingHorizontal: 14 },
  timeTrack: { flex: 1, height: 7, borderRadius: 999, backgroundColor: '#d5e2e2', overflow: 'hidden' },
  timeFill: { height: '100%', borderRadius: 999, backgroundColor: '#0aa493' }, timeFillCritical: { backgroundColor: '#e65a4d' },
  elapsed: { color: '#70828b', fontSize: 10, fontWeight: '800', minWidth: 24, textAlign: 'right' },
  arena: { flex: 1, paddingHorizontal: 15, paddingBottom: 8 }, gameSummary: { paddingTop: 8 },
  questionArea: { flex: 1, justifyContent: 'center', paddingHorizontal: 5 }, feedbackStack: { height: 82, position: 'relative', width: '100%' }, question: { color: '#0b2639', fontSize: 46, lineHeight: 54, fontWeight: '900', textAlign: 'center', marginVertical: 5 },
  input: { height: 57, borderRadius: 15, borderWidth: 2, borderColor: '#8dd7ce', backgroundColor: 'rgba(255,255,255,0.82)', color: '#102a3e', fontSize: 27, fontWeight: '900', textAlign: 'center', marginTop: 8 },
  primary: { minHeight: 52, backgroundColor: '#0aa493', borderRadius: 15, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }, primaryText: { color: '#fff', fontSize: 16, fontWeight: '900' }, disabled: { opacity: 0.45 },
  good: { color: '#087f73' }, bad: { color: '#b43a32' }, error: { color: '#a43a32', textAlign: 'center', lineHeight: 19, marginTop: 5 },
  stats: { flexDirection: 'row', marginTop: 4 }, stat: { flex: 1, alignItems: 'center', paddingVertical: 4 }, statValue: { color: '#102a3e', fontSize: 22, lineHeight: 25, fontWeight: '900' }, statLabel: { color: '#657b86', fontFamily: 'monospace', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 1, textAlign: 'center', textTransform: 'uppercase' },
  feedbackCard: { borderRadius: 10, borderWidth: 1, gap: 2, left: 0, minHeight: 36, paddingHorizontal: 9, paddingVertical: 4, position: 'absolute', right: 0 }, feedbackGood: { backgroundColor: 'rgba(229,248,244,0.94)', borderColor: '#a8ddd5' }, feedbackBad: { backgroundColor: 'rgba(255,239,236,0.95)', borderColor: '#efc1ba' },
  feedbackHeading: { alignItems: 'center', flexDirection: 'row', gap: 4 }, feedbackTitle: { fontSize: 10, fontWeight: '900' }, feedbackPrompt: { color: '#536b76', flex: 1, fontSize: 9, fontWeight: '700', textAlign: 'right' }, feedbackValues: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, feedbackValue: { color: '#607681', fontSize: 8 }, feedbackStrong: { color: '#102a3e', fontSize: 9, fontWeight: '900' },
});
