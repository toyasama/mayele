import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { MatchData, MatchParticipantData } from '@/lib/api';
import { opponentFor, participantFor } from '@/lib/multiplayerRoom';
import { formatResponseTime } from '@/lib/soloResult';

type MultiplayerResultScreenProps = {
  action: string | null;
  error: string | null;
  match: MatchData;
  onLeave: () => void;
  onRematch: () => void;
  playerId: string;
};

type Outcome = 'win' | 'loss' | 'draw';

const SCORE_ANIMATION_DURATION_MS = 3_000;

const GAME_LABELS: Record<NonNullable<MatchData['game']>, string> = {
  addition: 'Addition',
  soustraction: 'Soustraction',
  multiplication: 'Multiplication',
  division: 'Division',
  mixte: 'Mixte',
};

const LEVEL_LABELS: Record<NonNullable<MatchData['level']>, string> = {
  debutant: 'Débutant',
  intermediaire: 'Intermédiaire',
  avance: 'Avancé',
  expert: 'Expert',
};

export function MultiplayerResultScreen({
  action,
  error,
  match,
  onLeave,
  onRematch,
  playerId,
}: MultiplayerResultScreenProps) {
  const me = participantFor(match, playerId);
  const opponent = opponentFor(match, playerId);
  const draw = !match.winnerPlayerId;
  const won = match.winnerPlayerId === playerId;
  const myOutcome: Outcome = draw ? 'draw' : won ? 'win' : 'loss';
  const opponentOutcome: Outcome = draw ? 'draw' : won ? 'loss' : 'win';
  const rematchRequested = Boolean(me?.rematchRequestedAt);
  const opponentRematchRequested = Boolean(opponent?.rematchRequestedAt);
  const opponentDismissed = Boolean(opponent?.resultDismissedAt);
  const rematchDisabled = Boolean(action) || rematchRequested || opponentDismissed;
  const context = [
    match.challengeMode === 'tempo' ? 'Tempo' : 'Sprint',
    match.game ? GAME_LABELS[match.game] : null,
    match.level ? LEVEL_LABELS[match.level] : null,
  ].filter(Boolean).join(' · ');

  const rematchLabel = opponentDismissed
    ? 'Revanche indisponible'
    : rematchRequested
      ? 'Revanche demandée'
      : opponentRematchRequested
        ? 'Accepter la revanche'
        : 'Rejouer ce duel';

  return (
    <SafeAreaView style={styles.safe}>
      <View pointerEvents="none" style={styles.auraMint} />
      <View pointerEvents="none" style={styles.auraGold} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[
            styles.resultIcon,
            won ? styles.resultIconWin : draw ? styles.resultIconDraw : styles.resultIconLoss,
          ]}>
            <Ionicons
              color={won ? '#087f73' : draw ? '#607681' : '#a64940'}
              name={won ? 'trophy-outline' : draw ? 'remove-outline' : 'ribbon-outline'}
              size={29}
            />
          </View>
          <Text style={styles.eyebrow}>DÉFI TERMINÉ</Text>
          <Text style={styles.title}>{won ? 'Victoire !' : draw ? 'Égalité' : 'Défaite'}</Text>
          <Text style={styles.context}>{context}</Text>
        </View>

        <View style={styles.duel}>
          <ResultPlayer label="Vous" outcome={myOutcome} participant={me} />
          <View style={styles.versus}>
            <View style={styles.versusLine} />
            <Text style={styles.versusText}>VS</Text>
            <View style={styles.versusLine} />
          </View>
          <ResultPlayer label={opponent?.player.name ?? 'Adversaire'} outcome={opponentOutcome} participant={opponent} />
        </View>

        <RoomScoreboard
          leftName="Vous"
          leftStats={me?.challengeStats.room}
          rightName={opponent?.player.name ?? 'Adversaire'}
          rightStats={opponent?.challengeStats.room}
        />

        <View style={styles.comparison}>
          <ComparisonRow
            icon="checkmark-circle-outline"
            label="Bonnes réponses"
            left={answerRatio(me)}
            right={answerRatio(opponent)}
          />
          <ComparisonRow
            icon="flame-outline"
            label="Meilleure série"
            left={String(me?.bestStreak ?? 0)}
            right={String(opponent?.bestStreak ?? 0)}
          />
          <ComparisonRow
            icon="stopwatch-outline"
            label="Temps moyen"
            left={averageTime(me)}
            right={averageTime(opponent)}
          />
          <ComparisonRow
            icon="flash-outline"
            label="XP gagnés"
            last
            left={`+${me?.xp ?? 0}`}
            right={`+${opponent?.xp ?? 0}`}
          />
        </View>

        {rematchRequested && !opponentRematchRequested && !opponentDismissed ? (
          <View style={styles.statusLine}>
            <ActivityIndicator color="#0a9587" size="small" />
            <Text style={styles.statusText}>Demande envoyée, en attente de l’adversaire…</Text>
          </View>
        ) : null}
        {opponentRematchRequested && !rematchRequested && !opponentDismissed ? (
          <View style={styles.statusLine}>
            <Ionicons color="#087f73" name="refresh-circle-outline" size={18} />
            <Text style={styles.statusText}>{opponent?.player.name ?? 'Ton adversaire'} propose une revanche.</Text>
          </View>
        ) : null}
        {opponentDismissed ? (
          <View style={[styles.statusLine, styles.statusLineMuted]}>
            <Ionicons color="#6a7e88" name="exit-outline" size={17} />
            <Text style={styles.statusTextMuted}>L’adversaire a quitté le résultat.</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.actions}>
          <Pressable
            disabled={rematchDisabled}
            onPress={onRematch}
            style={({ pressed }) => [styles.primaryButton, (pressed || rematchDisabled) && styles.disabled]}
          >
            {action === 'rematch' ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Ionicons color="#fff" name="refresh" size={18} />
            )}
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.primaryButtonText}>{rematchLabel}</Text>
          </Pressable>
          <Pressable
            disabled={Boolean(action)}
            onPress={onLeave}
            style={({ pressed }) => [styles.leaveButton, (pressed || Boolean(action)) && styles.disabled]}
          >
            {action === 'leave' ? (
              <ActivityIndicator color="#173246" size="small" />
            ) : (
              <Ionicons color="#173246" name="exit-outline" size={18} />
            )}
            <Text style={styles.leaveButtonText}>Quitter</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function ResultPlayer({
  label,
  outcome,
  participant,
}: {
  label: string;
  outcome: Outcome;
  participant: MatchParticipantData | null;
}) {
  return (
    <View style={styles.player}>
      <View style={[
        styles.avatar,
        outcome === 'win' ? styles.avatarWin : outcome === 'loss' ? styles.avatarLoss : styles.avatarDraw,
      ]}>
        {participant?.player.avatarUrl ? (
          <Image source={{ uri: participant.player.avatarUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={styles.avatarInitials}>{initials(participant?.player.name ?? label)}</Text>
        )}
        {outcome === 'win' ? (
          <View style={styles.crown}>
            <Ionicons color="#8b6500" name="trophy" size={11} />
          </View>
        ) : null}
      </View>
      <Text numberOfLines={1} style={styles.playerName}>{label}</Text>
      <View style={[
        styles.outcomePill,
        outcome === 'win' ? styles.outcomeWin : outcome === 'loss' ? styles.outcomeLoss : styles.outcomeDraw,
      ]}>
        <Text style={[
          styles.outcomeText,
          outcome === 'win' ? styles.outcomeTextWin : outcome === 'loss' ? styles.outcomeTextLoss : styles.outcomeTextDraw,
        ]}>
          {participant?.forfeitedAt ? 'Abandon' : outcome === 'win' ? 'Gagnant' : outcome === 'loss' ? 'Deuxième' : 'Égalité'}
        </Text>
      </View>
      <AnimatedScore value={participant?.scorePoints ?? 0} />
      <Text style={styles.pointsLabel}>points</Text>
    </View>
  );
}

function AnimatedScore({ value }: { value: number }) {
  const animated = useRef(new Animated.Value(0)).current;
  const [displayedValue, setDisplayedValue] = useState(0);

  useEffect(() => {
    const listener = animated.addListener(({ value: nextValue }) => setDisplayedValue(Math.round(nextValue)));
    animated.setValue(0);
    const animation = Animated.sequence([
      Animated.delay(250),
      Animated.timing(animated, {
        duration: SCORE_ANIMATION_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        toValue: Math.max(0, value),
        useNativeDriver: false,
      }),
    ]);
    animation.start();

    return () => {
      animation.stop();
      animated.removeListener(listener);
    };
  }, [animated, value]);

  return <Text accessibilityLiveRegion="polite" style={styles.score}>{displayedValue}</Text>;
}

function RoomScoreboard({
  leftName,
  leftStats = { draws: 0, losses: 0, wins: 0 },
  rightName,
  rightStats = { draws: 0, losses: 0, wins: 0 },
}: {
  leftName: string;
  leftStats?: MatchParticipantData['challengeStats']['room'];
  rightName: string;
  rightStats?: MatchParticipantData['challengeStats']['room'];
}) {
  const draws = Math.max(leftStats.draws, rightStats.draws);
  const games = leftStats.wins + leftStats.losses + leftStats.draws;

  return (
    <View style={styles.roomScoreboard}>
      <Text style={styles.roomEyebrow}>BILAN DU SALON</Text>
      <View style={styles.roomScoreLine}>
        <View style={styles.roomScoreSide}>
          <Text numberOfLines={1} style={styles.roomPlayerName}>{leftName}</Text>
          <Text style={styles.roomScore}>{leftStats.wins}</Text>
        </View>
        <View style={styles.roomScoreCenter}>
          <Text style={styles.roomScoreDash}>—</Text>
          <Text style={styles.roomGames}>{games} manche{games === 1 ? '' : 's'}</Text>
        </View>
        <View style={[styles.roomScoreSide, styles.roomScoreSideRight]}>
          <Text numberOfLines={1} style={styles.roomPlayerName}>{rightName}</Text>
          <Text style={styles.roomScore}>{rightStats.wins}</Text>
        </View>
      </View>
      <View style={styles.roomRecords}>
        <RoomRecord stats={leftStats} />
        <View style={styles.drawSummary}>
          <Ionicons color="#667c85" name="remove-circle-outline" size={13} />
          <Text style={styles.drawSummaryText}>{draws} nul{draws === 1 ? '' : 's'}</Text>
        </View>
        <RoomRecord align="right" stats={rightStats} />
      </View>
    </View>
  );
}

function RoomRecord({
  align = 'left',
  stats,
}: {
  align?: 'left' | 'right';
  stats: MatchParticipantData['challengeStats']['room'];
}) {
  return (
    <View style={[styles.roomRecord, align === 'right' && styles.roomRecordRight]}>
      <Text style={styles.roomRecordWin}>{stats.wins} V</Text>
      <Text style={styles.roomRecordDraw}>{stats.draws} N</Text>
      <Text style={styles.roomRecordLoss}>{stats.losses} D</Text>
    </View>
  );
}

function ComparisonRow({
  icon,
  label,
  last = false,
  left,
  right,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  last?: boolean;
  left: string;
  right: string;
}) {
  return (
    <View style={[styles.comparisonRow, last && styles.comparisonRowLast]}>
      <Text style={styles.comparisonValue}>{left}</Text>
      <View style={styles.comparisonLabel}>
        <Ionicons color="#0a9587" name={icon} size={15} />
        <Text style={styles.comparisonLabelText}>{label}</Text>
      </View>
      <Text style={[styles.comparisonValue, styles.comparisonValueRight]}>{right}</Text>
    </View>
  );
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
}

function answerRatio(participant: MatchParticipantData | null) {
  return `${participant?.correctAnswers ?? 0}/${participant?.totalQuestions ?? 0}`;
}

function averageTime(participant: MatchParticipantData | null) {
  if (!participant?.totalQuestions) return '—';
  return formatResponseTime(Math.round(participant.totalResponseTimeMs / participant.totalQuestions));
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#f5faf9', flex: 1, overflow: 'hidden' },
  auraMint: { backgroundColor: '#dff8f3', borderRadius: 155, height: 310, opacity: 0.58, position: 'absolute', right: -145, top: 145, width: 310 },
  auraGold: { backgroundColor: '#fff7d9', borderRadius: 135, height: 270, left: -150, opacity: 0.46, position: 'absolute', top: 270, width: 270 },
  content: { alignSelf: 'center', flexGrow: 1, justifyContent: 'center', maxWidth: 520, paddingBottom: 19, paddingHorizontal: 14, paddingTop: 10, width: '100%' },
  hero: { alignItems: 'center', paddingBottom: 13 },
  resultIcon: { alignItems: 'center', borderRadius: 26, borderWidth: 1, height: 52, justifyContent: 'center', marginBottom: 8, width: 52 },
  resultIconWin: { backgroundColor: 'rgba(220,246,239,0.9)', borderColor: '#b8e3d9' },
  resultIconDraw: { backgroundColor: 'rgba(232,241,241,0.92)', borderColor: '#cededd' },
  resultIconLoss: { backgroundColor: 'rgba(251,231,227,0.9)', borderColor: '#ecc7c0' },
  eyebrow: { color: '#0a9587', fontSize: 10, fontWeight: '900', letterSpacing: 2.8 },
  title: { color: '#102a3e', fontSize: 28, fontWeight: '900', lineHeight: 34, marginTop: 4 },
  context: { color: '#687e87', fontSize: 10, fontWeight: '800', marginTop: 4 },
  duel: { alignItems: 'stretch', borderBottomColor: '#cfe3e0', borderBottomWidth: 1, borderTopColor: '#cfe3e0', borderTopWidth: 1, flexDirection: 'row', paddingVertical: 13 },
  player: { alignItems: 'center', flex: 1, minWidth: 0 },
  avatar: { alignItems: 'center', backgroundColor: '#dff5f0', borderRadius: 28, borderWidth: 2, height: 56, justifyContent: 'center', position: 'relative', width: 56 },
  avatarWin: { borderColor: '#28ae9d' },
  avatarLoss: { borderColor: '#e5aaa2' },
  avatarDraw: { borderColor: '#aac3c0' },
  avatarImage: { borderRadius: 25, height: 50, width: 50 },
  avatarInitials: { color: '#087f73', fontSize: 15, fontWeight: '900' },
  crown: { alignItems: 'center', backgroundColor: '#ffe89a', borderColor: '#f0cc57', borderRadius: 11, borderWidth: 1, height: 22, justifyContent: 'center', position: 'absolute', right: -6, top: -7, width: 22 },
  playerName: { color: '#173246', fontSize: 11, fontWeight: '900', marginTop: 6, maxWidth: '92%', textAlign: 'center' },
  outcomePill: { borderRadius: 999, marginTop: 5, paddingHorizontal: 8, paddingVertical: 3 },
  outcomeWin: { backgroundColor: '#d9f2ec' },
  outcomeLoss: { backgroundColor: '#f9dfdb' },
  outcomeDraw: { backgroundColor: '#e5eeee' },
  outcomeText: { fontSize: 8, fontWeight: '900', letterSpacing: 0.4, textTransform: 'uppercase' },
  outcomeTextWin: { color: '#087f73' },
  outcomeTextLoss: { color: '#a64940' },
  outcomeTextDraw: { color: '#607681' },
  score: { color: '#102a3e', fontSize: 30, fontWeight: '900', letterSpacing: -0.8, marginTop: 6 },
  pointsLabel: { color: '#6b8089', fontSize: 8, fontWeight: '800', marginTop: -2, textTransform: 'uppercase' },
  versus: { alignItems: 'center', justifyContent: 'center', width: 33 },
  versusLine: { backgroundColor: '#d1e2e0', flex: 1, width: 1 },
  versusText: { color: '#6e858d', fontSize: 9, fontWeight: '900', marginVertical: 6 },
  roomScoreboard: { borderBottomColor: '#cfe3e0', borderBottomWidth: 1, paddingBottom: 12, paddingTop: 11 },
  roomEyebrow: { color: '#0a9587', fontSize: 8, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  roomScoreLine: { alignItems: 'flex-end', flexDirection: 'row', marginTop: 5 },
  roomScoreSide: { alignItems: 'flex-start', flex: 1, minWidth: 0, paddingHorizontal: 4 },
  roomScoreSideRight: { alignItems: 'flex-end' },
  roomPlayerName: { color: '#687e87', fontSize: 9, fontWeight: '800', maxWidth: '100%' },
  roomScore: { color: '#102a3e', fontSize: 25, fontWeight: '900', letterSpacing: -0.7, marginTop: 1 },
  roomScoreCenter: { alignItems: 'center', width: 86 },
  roomScoreDash: { color: '#6f858d', fontSize: 19, fontWeight: '900' },
  roomGames: { color: '#748991', fontSize: 8, fontWeight: '800', marginTop: 1 },
  roomRecords: { alignItems: 'center', flexDirection: 'row', marginTop: 7 },
  roomRecord: { flex: 1, flexDirection: 'row', gap: 8, paddingHorizontal: 4 },
  roomRecordRight: { justifyContent: 'flex-end' },
  roomRecordWin: { color: '#087f73', fontSize: 9, fontWeight: '900' },
  roomRecordDraw: { color: '#667c85', fontSize: 9, fontWeight: '900' },
  roomRecordLoss: { color: '#a64940', fontSize: 9, fontWeight: '900' },
  drawSummary: { alignItems: 'center', flexDirection: 'row', gap: 3, justifyContent: 'center', width: 86 },
  drawSummaryText: { color: '#667c85', fontSize: 8, fontWeight: '800' },
  comparison: { borderBottomColor: '#cfe3e0', borderBottomWidth: 1, marginTop: 3 },
  comparisonRow: { alignItems: 'center', borderBottomColor: '#d9e8e6', borderBottomWidth: 1, flexDirection: 'row', minHeight: 39 },
  comparisonRowLast: { borderBottomWidth: 0 },
  comparisonValue: { color: '#102a3e', fontSize: 13, fontWeight: '900', paddingHorizontal: 4, textAlign: 'left', width: 72 },
  comparisonValueRight: { textAlign: 'right' },
  comparisonLabel: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: 5, justifyContent: 'center' },
  comparisonLabelText: { color: '#627983', fontSize: 10, fontWeight: '800', textAlign: 'center' },
  statusLine: { alignItems: 'center', backgroundColor: 'rgba(218,244,238,0.78)', borderRadius: 999, flexDirection: 'row', gap: 7, justifyContent: 'center', marginTop: 13, minHeight: 35, paddingHorizontal: 12, paddingVertical: 7 },
  statusLineMuted: { backgroundColor: 'rgba(229,238,238,0.72)' },
  statusText: { color: '#087f73', flexShrink: 1, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  statusTextMuted: { color: '#657982', flexShrink: 1, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  footer: { backgroundColor: 'rgba(245,250,249,0.97)', borderTopColor: '#d5e6e4', borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 9 },
  error: { color: '#a43a32', fontSize: 10, fontWeight: '700', marginBottom: 7, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10 },
  primaryButton: { alignItems: 'center', backgroundColor: '#0aa493', borderRadius: 15, flex: 1.35, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 50, paddingHorizontal: 10 },
  primaryButtonText: { color: '#fff', flexShrink: 1, fontSize: 12, fontWeight: '900', textAlign: 'center' },
  leaveButton: { alignItems: 'center', backgroundColor: 'transparent', borderColor: '#bad6d2', borderRadius: 15, borderWidth: 1, flex: 0.8, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 50, paddingHorizontal: 9 },
  leaveButtonText: { color: '#173246', fontSize: 12, fontWeight: '900' },
  disabled: { opacity: 0.48 },
});
