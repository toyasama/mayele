import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, AppState, Easing, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MultiplayerResultScreen } from '@/components/MultiplayerResultScreen';
import { NumericKeypad } from '@/components/NumericKeypad';
import { useStableToken } from '@/hooks/useStableToken';
import { getCurrentPlayer, getMatch, heartbeatMatch, leaveMatch, type MatchData, type Player } from '@/lib/api';
import {
  buildResultPayload,
  computeScorePoints,
  errorCode,
  isSettlementConfirmed,
  isSettlementError,
  isUnknownRealtimeOutcome,
  makeLocalAnswer,
  parseIntegerAnswer,
  progressFromAnswers,
  remainingSeconds,
  removeLocalAnswer,
  shouldFinishSprint,
  upsertLocalAnswer,
  type LocalMultiplayerAnswer,
} from '@/lib/multiplayerGame';
import { generateMatchQuestion } from '@/lib/matchQuestions';
import { connectMultiplayerRealtime, type MultiplayerRealtimeConnection } from '@/lib/multiplayerRealtime';
import { isOlderMatchSnapshot, mergeMonotonicMatch, opponentFor, participantFor } from '@/lib/multiplayerRoom';
import { MULTIPLAYER_PLAY_ROUTE } from '@/lib/playNavigation';

function routeParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function messageFrom(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function currentStreak(answers: LocalMultiplayerAnswer[]) {
  let streak = 0;
  for (let index = answers.length - 1; index >= 0 && answers[index]?.isCorrect; index -= 1) streak += 1;
  return streak;
}

export default function MultiplayerArena() {
  const params = useLocalSearchParams<{ matchId?: string | string[] }>();
  const matchId = routeParam(params.matchId) ?? '';
  const getToken = useStableToken();
  const connectionRef = useRef<MultiplayerRealtimeConnection | null>(null);
  const matchRef = useRef<MatchData | null>(null);
  const playerIdRef = useRef<string | null>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const lastRoomEventIdRef = useRef(new Map<string, string>());
  const roomRevisionRef = useRef(new Map<string, number>());
  const questionIndexRef = useRef(0);
  const questionStartedAtRef = useRef(Date.now());
  const serverTimeOffsetRef = useRef(0);
  const activeRunKeyRef = useRef<string | null>(null);
  const answersRef = useRef<LocalMultiplayerAnswer[]>([]);
  const sprintSyncPromisesRef = useRef(new Set<Promise<void>>());
  const tempoPendingQuestionRef = useRef<number | null>(null);
  const resultSubmittedRef = useRef<string | null>(null);
  const finishAttemptedRef = useRef(false);
  const answerInputRef = useRef<TextInput>(null);

  const [player, setPlayer] = useState<Player | null>(null);
  const [match, setMatch] = useState<MatchData | null>(null);
  const [answer, setAnswer] = useState('');
  const [answers, setAnswers] = useState<LocalMultiplayerAnswer[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [finalizationFailed, setFinalizationFailed] = useState(false);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [feedbacks, setFeedbacks] = useState<{ id: string; answer: LocalMultiplayerAnswer; streak: number }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forfeitConfirmOpen, setForfeitConfirmOpen] = useState(false);

  const showFeedback = useCallback((nextAnswer: LocalMultiplayerAnswer, streak: number) => {
    const id = `${nextAnswer.questionIndex}:${nextAnswer.userAnswer ?? 'timeout'}`;
    setFeedbacks((current) => current.some((item) => item.id === id) ? current : [...current, { id, answer: nextAnswer, streak }].slice(-3));
  }, []);
  const dismissFeedback = useCallback((id: string) => setFeedbacks((current) => current.filter((item) => item.id !== id)), []);

  const serverNowMs = useCallback(() => Date.now() + serverTimeOffsetRef.current, []);

  const advanceTempoQuestion = useCallback((nextIndex: number, nextStartedAtMs: number) => {
    const current = matchRef.current;
    if (current?.challengeMode !== 'tempo' || nextIndex <= questionIndexRef.current) return;
    if (nextIndex >= (current.questionCount ?? 0)) {
      setWaiting(true);
      return;
    }
    questionIndexRef.current = nextIndex;
    questionStartedAtRef.current = nextStartedAtMs;
    tempoPendingQuestionRef.current = null;
    setQuestionIndex(nextIndex);
    setRemaining(null);
    setWaiting(false);
    setAnswer('');
    requestAnimationFrame(() => answerInputRef.current?.focus());
  }, []);

  const applyMatch = useCallback((next: MatchData) => {
    const previous = matchRef.current;
    if (next.id !== matchId) {
      if (previous?.status === 'completed' && previous.roomId && next.roomId === previous.roomId) {
        router.replace(MULTIPLAYER_PLAY_ROUTE);
      }
      return;
    }
    if (isOlderMatchSnapshot(previous, next)) return;
    const merged = mergeMonotonicMatch(previous, next);
    matchRef.current = merged;
    serverTimeOffsetRef.current = new Date(merged.serverNow).getTime() - Date.now();
    setMatch(merged);

    if (merged.status === 'completed') {
      setWaiting(false);
      setRemaining(null);
      setFinalizationFailed(false);
      return;
    }

    if (merged.challengeMode === 'tempo' && typeof merged.tempoQuestionIndex === 'number') {
      const startedAtMs = merged.tempoQuestionStartedAt
        ? new Date(merged.tempoQuestionStartedAt).getTime()
        : new Date(merged.serverNow).getTime();
      if (merged.tempoQuestionIndex > questionIndexRef.current) {
        advanceTempoQuestion(merged.tempoQuestionIndex, startedAtMs);
      } else if (merged.tempoQuestionIndex === questionIndexRef.current && merged.tempoQuestionStartedAt) {
        questionStartedAtRef.current = startedAtMs;
      }
    }

    const participant = merged.participants.find((item) => item.player.id === playerIdRef.current);
    if (participant?.status === 'submitting' || participant?.status === 'completed') setWaiting(true);
  }, [advanceTempoQuestion, matchId]);

  const refreshMatch = useCallback(async () => {
    if (!matchId) throw new Error('Identifiant du défi manquant.');
    const next = await getMatch(getToken, matchId);
    applyMatch(next);
    return next;
  }, [applyMatch, getToken, matchId]);

  const load = useCallback(async () => {
    if (!matchId) throw new Error('Ce défi n’est plus disponible.');
    const [nextPlayer, nextMatch] = await Promise.all([getCurrentPlayer(getToken), getMatch(getToken, matchId)]);
    playerIdRef.current = nextPlayer.id;
    setPlayer(nextPlayer);
    applyMatch(nextMatch);
  }, [applyMatch, getToken, matchId]);

  useEffect(() => {
    void load().catch((reason) => setError(messageFrom(reason, 'Défi introuvable.')));
  }, [load]);

  useEffect(() => {
    let active = true;
    void connectMultiplayerRealtime(getToken, {
      onDisconnected: () => {
        if (!active) return;
        joinedRoomRef.current = null;
        setRealtimeReady(false);
      },
      onError: (reason) => { if (active) setError(reason.message); },
      onMatch: (next) => { if (active) applyMatch(next); },
      onReady: () => {
        if (!active) return;
        setRealtimeReady(true);
        setError(null);
        void refreshMatch().catch(() => undefined);
      },
      onRoomEvent: (event) => {
        if (!active || event.revision <= (roomRevisionRef.current.get(event.roomId) ?? -1)) return;
        roomRevisionRef.current.set(event.roomId, event.revision);
        lastRoomEventIdRef.current.set(event.roomId, event.eventId);
        applyMatch(event.match);
      },
      onRoomSnapshot: (snapshot) => {
        if (!active || snapshot.revision < (roomRevisionRef.current.get(snapshot.roomId) ?? -1)) return;
        roomRevisionRef.current.set(snapshot.roomId, snapshot.revision);
        applyMatch(snapshot.match);
      },
      onTempoProgress: (progress) => {
        if (!active || progress.matchId !== matchId) return;
        advanceTempoQuestion(progress.nextQuestionIndex, new Date(progress.at).getTime());
      },
    }).then((connection) => {
      if (!active) return connection.disconnect();
      connectionRef.current = connection;
    }).catch((reason) => {
      if (active) setError(messageFrom(reason, 'Connexion au défi impossible.'));
    });
    return () => {
      active = false;
      joinedRoomRef.current = null;
      connectionRef.current?.disconnect();
      connectionRef.current = null;
    };
  }, [advanceTempoQuestion, applyMatch, getToken, matchId, refreshMatch]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => connectionRef.current?.setPresenceActivity(state === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!realtimeReady || !match || !connectionRef.current) return;
    const roomId = match.roomId ?? match.id;
    if (joinedRoomRef.current === roomId) return;
    joinedRoomRef.current = roomId;
    void connectionRef.current.joinRoom(roomId, lastRoomEventIdRef.current.get(roomId) ?? null).catch((reason) => {
      joinedRoomRef.current = null;
      setError(messageFrom(reason, 'Salon temps réel indisponible.'));
    });
  }, [match, match?.id, match?.roomId, realtimeReady]);

  const isHost = Boolean(match && player && match.createdBy.id === player.id);
  const heartbeatMatchId = match && isHost && ['pending', 'accepted', 'ready', 'in_progress'].includes(match.status) ? match.id : null;
  useEffect(() => {
    if (!heartbeatMatchId) return;
    let active = true;
    const beat = async () => {
      try {
        const next = await heartbeatMatch(getToken, heartbeatMatchId);
        if (active) applyMatch(next);
      } catch (reason) {
        if (active && errorCode(reason) !== 'match_not_pending') setError(messageFrom(reason, 'Synchronisation de la partie interrompue.'));
      }
    };
    const first = setTimeout(() => void beat(), 750);
    const interval = setInterval(() => void beat(), 5_000);
    return () => { active = false; clearTimeout(first); clearInterval(interval); };
  }, [applyMatch, getToken, heartbeatMatchId]);

  useEffect(() => {
    if (!match || (realtimeReady && !waiting && !action)) return;
    const interval = setInterval(() => void refreshMatch().catch(() => undefined), 2_500);
    return () => clearInterval(interval);
  }, [action, match, realtimeReady, refreshMatch, waiting]);

  useEffect(() => {
    if (match?.status !== 'in_progress') return;
    const runKey = `${match.id}:${match.startedAt ?? 'pending'}`;
    if (activeRunKeyRef.current === runKey) return;
    activeRunKeyRef.current = runKey;
    answersRef.current = [];
    setAnswers([]);
    tempoPendingQuestionRef.current = null;
    resultSubmittedRef.current = null;
    finishAttemptedRef.current = false;
    setFinalizationFailed(false);
    setWaiting(false);
    setAnswer('');
    setFeedbacks([]);
    setRemaining(null);
    const initialIndex = match.challengeMode === 'tempo' ? match.tempoQuestionIndex ?? 0 : 0;
    questionIndexRef.current = initialIndex;
    setQuestionIndex(initialIndex);
    questionStartedAtRef.current = match.challengeMode === 'tempo' && match.tempoQuestionStartedAt
      ? new Date(match.tempoQuestionStartedAt).getTime()
      : serverNowMs();
  }, [match?.id, match?.startedAt, match?.status, match?.tempoQuestionIndex, match?.tempoQuestionStartedAt, match?.challengeMode, serverNowMs]);

  useEffect(() => {
    if (match?.status !== 'in_progress') {
      setRemaining(null);
      return;
    }
    const startedAtMs = match.challengeMode === 'tempo' && match.tempoQuestionStartedAt
      ? new Date(match.tempoQuestionStartedAt).getTime()
      : questionStartedAtRef.current;
    if (match.challengeMode === 'tempo') questionStartedAtRef.current = startedAtMs;
    const targetMs = match.challengeMode === 'sprint'
      ? new Date(match.endsAt ?? (serverNowMs() + match.durationSeconds * 1000)).getTime()
      : startedAtMs + (match.perQuestionTimeLimitSeconds ?? 10) * 1000;
    const update = () => setRemaining(remainingSeconds(targetMs, serverNowMs()));
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [match?.challengeMode, match?.durationSeconds, match?.endsAt, match?.id, match?.perQuestionTimeLimitSeconds, match?.status, match?.tempoQuestionStartedAt, questionIndex, serverNowMs]);

  const question = useMemo(() => {
    if (!match?.questionSeed || !match.game || !match.level) return null;
    return generateMatchQuestion(match.questionSeed, questionIndex, match.game, match.level);
  }, [match?.game, match?.level, match?.questionSeed, questionIndex]);

  const finishSprint = useCallback(async (retry = false) => {
    const current = matchRef.current;
    const playerId = playerIdRef.current;
    if (!current || current.challengeMode !== 'sprint' || current.status !== 'in_progress' || !playerId) return;
    const submissionKey = `${current.id}:${playerId}`;
    if (resultSubmittedRef.current === submissionKey || (finishAttemptedRef.current && !retry)) return;
    const connection = connectionRef.current;
    if (!connection) {
      setFinalizationFailed(true);
      setError('Connexion temps réel indisponible.');
      return;
    }
    finishAttemptedRef.current = true;
    resultSubmittedRef.current = submissionKey;
    setAction('result');
    setWaiting(true);
    setFinalizationFailed(false);
    setError(null);
    try {
      await Promise.allSettled(Array.from(sprintSyncPromisesRef.current));
      const startedAtMs = new Date(current.startedAt ?? current.serverNow).getTime();
      const response = await connection.submitResult(current.id, buildResultPayload(startedAtMs, serverNowMs(), answersRef.current));
      applyMatch(response.match);
    } catch (reason) {
      if (!isSettlementConfirmed(matchRef.current, current.id, playerId) && (isSettlementError(reason) || isUnknownRealtimeOutcome(reason))) {
        try {
          const fresh = await getMatch(getToken, current.id);
          applyMatch(fresh);
        } catch {
          // L’erreur initiale reste la plus utile à afficher.
        }
      }
      if (!isSettlementConfirmed(matchRef.current, current.id, playerId)) {
        resultSubmittedRef.current = null;
        setFinalizationFailed(true);
        setError(messageFrom(reason, 'Impossible d’enregistrer le résultat.'));
      }
    } finally {
      setAction(null);
    }
  }, [applyMatch, getToken, serverNowMs]);

  const submitTempoAnswer = useCallback(async (source: 'manual' | 'timeout') => {
    const current = matchRef.current;
    const currentQuestionIndex = questionIndexRef.current;
    if (!current || current.status !== 'in_progress' || current.challengeMode !== 'tempo' || tempoPendingQuestionRef.current === currentQuestionIndex) return;
    if (!current.questionSeed || !current.game || !current.level) return setError('Configuration de défi incomplète.');
    const parsed = parseIntegerAnswer(answer);
    if (source === 'manual' && parsed === null) return setError('Entre un nombre entier.');
    const connection = connectionRef.current;
    if (!connection) return setError('Connexion temps réel indisponible.');
    const currentQuestion = generateMatchQuestion(current.questionSeed, currentQuestionIndex, current.game, current.level);
    const limitMs = Math.max(1, current.perQuestionTimeLimitSeconds ?? 10) * 1000;
    const local = makeLocalAnswer(
      currentQuestion,
      currentQuestionIndex,
      parsed,
      Math.max(0, Math.min(limitMs, serverNowMs() - questionStartedAtRef.current)),
      source,
    );
    const nextAnswers = upsertLocalAnswer(answersRef.current, local);
    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    tempoPendingQuestionRef.current = currentQuestionIndex;
    setWaiting(true);
    setAnswer('');
    showFeedback(local, currentStreak(nextAnswers));
    setError(null);
    try {
      const response = await connection.submitTempoAnswer(current.id, local);
      applyMatch(response.match);
      if (response.progress.complete) {
        const nextStartedAtMs = response.match.tempoQuestionStartedAt
          ? new Date(response.match.tempoQuestionStartedAt).getTime()
          : new Date(response.match.serverNow).getTime();
        advanceTempoQuestion(response.progress.nextQuestionIndex, nextStartedAtMs);
      }
    } catch (reason) {
      if (questionIndexRef.current !== currentQuestionIndex) return;
      if (['match_result_invalid', 'match_tempo_answer_invalid'].includes(errorCode(reason) ?? '')) {
        void refreshMatch().catch(() => undefined);
      }
      tempoPendingQuestionRef.current = null;
      const rolledBack = removeLocalAnswer(answersRef.current, currentQuestionIndex);
      answersRef.current = rolledBack;
      setAnswers(rolledBack);
      dismissFeedback(`${currentQuestionIndex}:${parsed ?? 'timeout'}`);
      setWaiting(false);
      if (parsed !== null) setAnswer(String(parsed));
      setError(messageFrom(reason, 'Réponse non enregistrée.'));
    }
  }, [advanceTempoQuestion, answer, applyMatch, dismissFeedback, refreshMatch, serverNowMs, showFeedback]);

  const submitSprintAnswer = useCallback(() => {
    const current = matchRef.current;
    if (!current || current.status !== 'in_progress' || current.challengeMode !== 'sprint' || !current.questionSeed || !current.game || !current.level) return;
    const parsed = parseIntegerAnswer(answer);
    if (parsed === null) return setError('Entre un nombre entier.');
    const connection = connectionRef.current;
    if (!connection) return setError('Connexion temps réel indisponible.');
    const currentQuestionIndex = questionIndexRef.current;
    const currentQuestion = generateMatchQuestion(current.questionSeed, currentQuestionIndex, current.game, current.level);
    const local = makeLocalAnswer(currentQuestion, currentQuestionIndex, parsed, Math.max(0, Math.min(90_000, serverNowMs() - questionStartedAtRef.current)), 'manual');
    const nextAnswers = upsertLocalAnswer(answersRef.current, local);
    answersRef.current = nextAnswers;
    setAnswers(nextAnswers);
    showFeedback(local, currentStreak(nextAnswers));
    setAnswer('');
    setError(null);
    questionIndexRef.current += 1;
    questionStartedAtRef.current = serverNowMs();
    setQuestionIndex(questionIndexRef.current);

    let submission: Promise<void>;
    submission = connection.submitSprintAnswer(current.id, local)
      .then((response) => { applyMatch(response.match); })
      .catch((reason) => {
        if (!isSettlementConfirmed(matchRef.current, current.id, playerIdRef.current)) {
          setError(messageFrom(reason, 'Réponse Sprint non enregistrée.'));
        }
      })
      .finally(() => { sprintSyncPromisesRef.current.delete(submission); });
    sprintSyncPromisesRef.current.add(submission);
  }, [answer, applyMatch, serverNowMs, showFeedback]);

  const submit = useCallback(() => {
    if (matchRef.current?.challengeMode === 'tempo') void submitTempoAnswer('manual');
    else submitSprintAnswer();
  }, [submitSprintAnswer, submitTempoAnswer]);

  useEffect(() => {
    if (shouldFinishSprint(match, remaining, realtimeReady, resultSubmittedRef.current !== null || finishAttemptedRef.current)) {
      void finishSprint();
    }
  }, [finishSprint, match, realtimeReady, remaining]);

  useEffect(() => {
    if (match?.status === 'in_progress' && match.challengeMode === 'tempo' && remaining === 0 && tempoPendingQuestionRef.current !== questionIndexRef.current) {
      void submitTempoAnswer('timeout');
    }
  }, [match?.challengeMode, match?.status, remaining, submitTempoAnswer]);

  const confirmForfeit = useCallback(async () => {
    const current = matchRef.current;
    const connection = connectionRef.current;
    if (!current || !connection || action) return;
    setForfeitConfirmOpen(false);
    setAction('forfeit');
    setError(null);
    try {
      await Promise.allSettled(Array.from(sprintSyncPromisesRef.current));
      const response = await connection.forfeit(current.id, progressFromAnswers(current.level, answersRef.current));
      applyMatch(response.match);
    } catch (reason) {
      if (isUnknownRealtimeOutcome(reason) || isSettlementError(reason)) {
        try { await refreshMatch(); } catch { /* conserver l’erreur de commande */ }
      }
      if (matchRef.current?.status !== 'completed') setError(messageFrom(reason, 'Impossible d’abandonner la partie.'));
    } finally {
      setAction(null);
    }
  }, [action, applyMatch, refreshMatch]);

  const requestRematch = useCallback(async () => {
    const current = matchRef.current;
    const connection = connectionRef.current;
    if (!current || !connection || action) return;
    setAction('rematch');
    setError(null);
    try {
      const response = await connection.requestRematch(current.id);
      if (response.match.id === current.id) applyMatch(response.match);
      else router.replace(MULTIPLAYER_PLAY_ROUTE);
    } catch (reason) {
      setError(messageFrom(reason, 'Relance impossible.'));
    } finally {
      setAction(null);
    }
  }, [action, applyMatch]);

  const leaveResult = useCallback(async () => {
    const current = matchRef.current;
    const connection = connectionRef.current;
    if (!current || action) return;
    setAction('leave');
    setError(null);
    try {
      if (connection) {
        try {
          await connection.leave(current.id);
        } catch (reason) {
          if (!['realtime_timeout', 'realtime_invalid_response', 'realtime_unavailable', 'realtime_closed'].includes(errorCode(reason) ?? '')) throw reason;
          await leaveMatch(getToken, current.id);
        }
      } else {
        await leaveMatch(getToken, current.id);
      }
      router.replace(MULTIPLAYER_PLAY_ROUTE);
    } catch (reason) {
      setError(messageFrom(reason, 'Impossible de quitter le résultat.'));
    } finally {
      setAction(null);
    }
  }, [action, getToken]);

  if (error && (!match || !player)) {
    return <SafeAreaView style={styles.center}><Ionicons color="#b53a32" name="alert-circle-outline" size={38} /><Text style={styles.error}>{error}</Text><Pressable onPress={() => router.replace(MULTIPLAYER_PLAY_ROUTE)} style={styles.primary}><Text style={styles.primaryText}>Retour au salon multijoueur</Text></Pressable></SafeAreaView>;
  }
  if (!match || !player) return <View style={styles.center}><ActivityIndicator color="#11a696" size="large" /></View>;

  const me = participantFor(match, player.id);
  const opponent = opponentFor(match, player.id);
  if (match.status === 'completed') {
    return <MultiplayerResultScreen action={action} error={error} match={match} onLeave={() => void leaveResult()} onRematch={() => void requestRematch()} playerId={player.id} />;
  }
  if (match.status !== 'in_progress' || !question) {
    return <SafeAreaView style={styles.center}><Text style={styles.error}>{error ?? 'La partie n’est plus active.'}</Text><Pressable onPress={() => router.replace(MULTIPLAYER_PLAY_ROUTE)} style={styles.primary}><Text style={styles.primaryText}>Retour au salon multijoueur</Text></Pressable></SafeAreaView>;
  }

  const correct = answers.filter((item) => item.isCorrect).length;
  const totalSeconds = match.challengeMode === 'tempo' ? match.perQuestionTimeLimitSeconds ?? 10 : match.durationSeconds;
  const displayedRemaining = remaining ?? totalSeconds;
  const elapsed = Math.max(0, totalSeconds - displayedRemaining);
  const timerProgress = Math.min(100, Math.max(0, (elapsed / totalSeconds) * 100));
  const operationLabel = match.game === 'mixte' ? 'MIXTE' : match.game?.toUpperCase();
  const levelLabel = match.level?.toUpperCase();
  const participantSettled = me?.status === 'submitting' || me?.status === 'completed';
  const showWaiting = waiting || participantSettled || (match.challengeMode === 'sprint' && displayedRemaining === 0);
  const inputBusy = Boolean(action) || showWaiting;

  return <SafeAreaView style={styles.safe}>
    <View pointerEvents="none" style={styles.auraMint} /><View pointerEvents="none" style={styles.auraGold} />
    <View style={styles.top}>
      <Pressable accessibilityLabel="Abandonner la partie" disabled={Boolean(action)} onPress={() => setForfeitConfirmOpen(true)} style={styles.close}><Ionicons color="#163146" name="close" size={24} /></Pressable>
      <View style={styles.headerCenter}><Text style={styles.mode}>{match.challengeMode === 'sprint' ? 'SPRINT MULTI' : 'TEMPO MULTI'}</Text><Text numberOfLines={1} style={styles.headerContext}>{operationLabel} · {levelLabel}</Text></View>
      <View style={[styles.timer, displayedRemaining <= 10 && styles.timerCritical]}><Ionicons color={displayedRemaining <= 10 ? '#b43a32' : '#11a696'} name="timer-outline" size={18} /><Text style={[styles.timerText, displayedRemaining <= 10 && styles.timerCriticalText]}>{displayedRemaining}s</Text></View>
    </View>
    <View style={styles.timeBarRow}><View style={styles.timeTrack}><View style={[styles.timeFill, displayedRemaining <= 10 && styles.timeFillCritical, { width: `${timerProgress}%` }]} /></View><Text style={styles.elapsed}>{elapsed}s</Text></View>
    <View style={styles.connectionRow}><View style={[styles.connectionDot, realtimeReady && styles.connectionDotReady]} /><Text numberOfLines={1} style={styles.connectionText}>vs {opponent?.player.name ?? 'adversaire'} · {realtimeReady ? 'synchronisé' : 'reconnexion…'}</Text></View>
    <View style={styles.arena}>
      <View style={styles.stats}><Stat value={correct} label="Justes" /><Stat value={currentStreak(answers)} label="Série" /><Stat value={computeScorePoints(match.level, answers)} label="Score" /></View>
      <View style={styles.questionArea}>
        <View pointerEvents="none" style={styles.feedbackStack}>{feedbacks.map((item, index) => <AnswerFeedback answer={item.answer} id={item.id} key={item.id} onDismiss={dismissFeedback} stackIndex={feedbacks.length - 1 - index} streak={item.streak} />)}</View>
        <Text style={styles.question}>{question.prompt}</Text>
        {showWaiting ? <View style={styles.waiting}><ActivityIndicator color="#11a696" /><Text style={styles.waitingText}>{participantSettled ? 'Résultat envoyé. En attente de l’adversaire…' : match.challengeMode === 'tempo' ? 'Réponse enregistrée. En attente de l’adversaire…' : finalizationFailed ? 'Le résultat doit être renvoyé.' : 'Enregistrement du résultat…'}</Text>{finalizationFailed ? <Pressable disabled={action === 'result'} onPress={() => { finishAttemptedRef.current = false; void finishSprint(true); }} style={styles.retryButton}><Text style={styles.retryText}>Réessayer</Text></Pressable> : null}</View> : <TextInput ref={answerInputRef} autoFocus caretHidden contextMenuHidden editable={!inputBusy} keyboardType="number-pad" onChangeText={(value) => { setAnswer(value); setError(null); }} onSubmitEditing={submit} placeholder="Ta réponse" placeholderTextColor="#9aabb3" showSoftInputOnFocus={false} style={styles.input} value={answer} />}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      {!showWaiting ? <NumericKeypad answer={answer} busy={inputBusy} onChange={(value) => { setAnswer(value); setError(null); }} onSubmit={submit} /> : null}
    </View>

    <ConfirmForfeitModal busy={action === 'forfeit'} onCancel={() => setForfeitConfirmOpen(false)} onConfirm={() => void confirmForfeit()} open={forfeitConfirmOpen} />
  </SafeAreaView>;
}

function Stat({ value, label }: { value: number; label: string }) {
  return <View style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function AnswerFeedback({ answer, id, onDismiss, stackIndex, streak }: { answer: LocalMultiplayerAnswer; id: string; onDismiss: (id: string) => void; stackIndex: number; streak: number }) {
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

function ConfirmForfeitModal({ busy, onCancel, onConfirm, open }: { busy: boolean; onCancel: () => void; onConfirm: () => void; open: boolean }) {
  return <Modal animationType="fade" onRequestClose={onCancel} transparent visible={open}><View style={styles.modalBackdrop}><View accessibilityViewIsModal style={styles.modalCard}><View style={styles.modalIcon}><Ionicons color="#a33d35" name="flag-outline" size={27} /></View><Text style={styles.modalTitle}>Abandonner la partie ?</Text><Text style={styles.modalText}>La partie sera terminée immédiatement et ton adversaire remportera le défi.</Text><View style={styles.modalActions}><Pressable disabled={busy} onPress={onCancel} style={styles.modalKeep}><Text style={styles.modalKeepText}>Continuer</Text></Pressable><Pressable disabled={busy} onPress={onConfirm} style={styles.modalForfeit}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalForfeitText}>Abandonner</Text>}</Pressable></View></View></View></Modal>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#f5faf9', flex: 1, overflow: 'hidden' }, center: { alignItems: 'center', backgroundColor: '#f3f8f7', flex: 1, gap: 14, justifyContent: 'center', padding: 26 },
  auraMint: { position: 'absolute', width: 310, height: 310, borderRadius: 155, backgroundColor: '#dff8f3', opacity: 0.58, top: 145, right: -145 }, auraGold: { position: 'absolute', width: 270, height: 270, borderRadius: 135, backgroundColor: '#fff7d9', opacity: 0.46, top: 270, left: -150 },
  top: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.9)', flexDirection: 'row', height: 72, justifyContent: 'space-between', paddingHorizontal: 14 }, close: { alignItems: 'center', borderColor: '#dce8e8', borderRadius: 21, borderWidth: 1, height: 42, justifyContent: 'center', width: 42 }, headerCenter: { alignItems: 'center', flex: 1, paddingHorizontal: 5 }, mode: { color: '#0a9f8f', fontSize: 11, fontWeight: '900', letterSpacing: 2.1, textAlign: 'center' }, headerContext: { color: '#536d78', fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginTop: 4, textAlign: 'center' }, timer: { alignItems: 'center', backgroundColor: '#e6f7f3', borderRadius: 20, flexDirection: 'row', gap: 4, height: 39, justifyContent: 'center', minWidth: 66, paddingHorizontal: 10 }, timerCritical: { backgroundColor: '#fff0ee' }, timerText: { color: '#0c8479', fontWeight: '900' }, timerCriticalText: { color: '#b43a32' },
  timeBarRow: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.9)', flexDirection: 'row', gap: 9, paddingBottom: 8, paddingHorizontal: 14 }, timeTrack: { backgroundColor: '#d5e2e2', borderRadius: 999, flex: 1, height: 7, overflow: 'hidden' }, timeFill: { backgroundColor: '#0aa493', borderRadius: 999, height: '100%' }, timeFillCritical: { backgroundColor: '#e65a4d' }, elapsed: { color: '#70828b', fontSize: 10, fontWeight: '800', minWidth: 24, textAlign: 'right' },
  connectionRow: { alignItems: 'center', borderBottomColor: '#dce9e8', borderBottomWidth: 1, flexDirection: 'row', gap: 5, justifyContent: 'center', minHeight: 22 }, connectionDot: { backgroundColor: '#e49d32', borderRadius: 3, height: 6, width: 6 }, connectionDotReady: { backgroundColor: '#23b36b' }, connectionText: { color: '#6d818a', fontSize: 8, fontWeight: '800', maxWidth: '80%' },
  arena: { flex: 1, paddingBottom: 8, paddingHorizontal: 15 }, stats: { flexDirection: 'row', marginTop: 4 }, stat: { alignItems: 'center', flex: 1, paddingVertical: 4 }, statValue: { color: '#102a3e', fontSize: 22, fontWeight: '900', lineHeight: 25 }, statLabel: { color: '#657b86', fontFamily: 'monospace', fontSize: 9, fontWeight: '800', letterSpacing: 1, marginTop: 1, textAlign: 'center', textTransform: 'uppercase' },
  questionArea: { flex: 1, justifyContent: 'center', minHeight: 190, paddingHorizontal: 5 }, feedbackStack: { height: 82, position: 'relative', width: '100%' }, question: { color: '#0b2639', fontSize: 46, fontWeight: '900', lineHeight: 54, marginVertical: 5, textAlign: 'center' }, input: { backgroundColor: 'rgba(255,255,255,0.82)', borderColor: '#8dd7ce', borderRadius: 15, borderWidth: 2, color: '#102a3e', fontSize: 27, fontWeight: '900', height: 57, marginTop: 8, textAlign: 'center' }, good: { color: '#087f73' }, bad: { color: '#b43a32' }, error: { color: '#a43a32', lineHeight: 19, marginTop: 7, textAlign: 'center' },
  feedbackCard: { borderRadius: 10, borderWidth: 1, gap: 2, left: 0, minHeight: 36, paddingHorizontal: 9, paddingVertical: 4, position: 'absolute', right: 0 }, feedbackGood: { backgroundColor: 'rgba(229,248,244,0.94)', borderColor: '#a8ddd5' }, feedbackBad: { backgroundColor: 'rgba(255,239,236,0.95)', borderColor: '#efc1ba' }, feedbackHeading: { alignItems: 'center', flexDirection: 'row', gap: 4 }, feedbackTitle: { fontSize: 10, fontWeight: '900' }, feedbackPrompt: { color: '#536b76', flex: 1, fontSize: 9, fontWeight: '700', textAlign: 'right' }, feedbackValues: { flexDirection: 'row', gap: 8, justifyContent: 'space-between' }, feedbackValue: { color: '#607681', fontSize: 8 }, feedbackStrong: { color: '#102a3e', fontSize: 9, fontWeight: '900' },
  waiting: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#d4e7e5', borderRadius: 16, borderWidth: 1, gap: 9, justifyContent: 'center', minHeight: 108, padding: 16 }, waitingText: { color: '#526b78', fontSize: 11, fontWeight: '800', textAlign: 'center' }, retryButton: { backgroundColor: '#e6f7f3', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8 }, retryText: { color: '#087f73', fontSize: 10, fontWeight: '900' },
  primary: { alignItems: 'center', backgroundColor: '#11a696', borderRadius: 14, flexDirection: 'row', gap: 10, justifyContent: 'center', minHeight: 50, paddingHorizontal: 22 }, primaryText: { color: '#fff', fontSize: 14, fontWeight: '900', textAlign: 'center' }, secondary: { alignItems: 'center', borderColor: '#cbdedd', borderRadius: 14, borderWidth: 1, justifyContent: 'center', minHeight: 49 }, secondaryText: { color: '#173246', fontSize: 13, fontWeight: '900' }, disabled: { opacity: 0.48 },
  modalBackdrop: { alignItems: 'center', backgroundColor: 'rgba(10,31,43,0.5)', flex: 1, justifyContent: 'center', padding: 22 }, modalCard: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, maxWidth: 360, padding: 20, width: '100%' }, modalIcon: { alignItems: 'center', backgroundColor: '#fff0ee', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, modalTitle: { color: '#173246', fontSize: 20, fontWeight: '900', marginTop: 12 }, modalText: { color: '#627782', fontSize: 12, lineHeight: 18, marginTop: 7, textAlign: 'center' }, modalActions: { flexDirection: 'row', gap: 8, marginTop: 18, width: '100%' }, modalKeep: { alignItems: 'center', backgroundColor: '#eef4f4', borderRadius: 11, flex: 1, justifyContent: 'center', minHeight: 45 }, modalKeepText: { color: '#405966', fontSize: 11, fontWeight: '900' }, modalForfeit: { alignItems: 'center', backgroundColor: '#a54238', borderRadius: 11, flex: 1, justifyContent: 'center', minHeight: 45 }, modalForfeitText: { color: '#fff', fontSize: 11, fontWeight: '900' },
});
