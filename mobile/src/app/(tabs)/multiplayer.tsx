import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader } from '@/components/AppHeader';
import { DailyObjectives } from '@/components/DailyObjectives';
import { PlayContextSwitch } from '@/components/PlayContextSwitch';
import { useStableToken } from '@/hooks/useStableToken';
import { useDailyObjectives } from '@/hooks/useDailyObjectives';
import { getCurrentPlayer, getMatchRoomOverview, heartbeatMatch, type DailyObjective, type GameLevel, type GameType, type MatchData, type Player, type PublicPlayer } from '@/lib/api';
import { connectMultiplayerRealtime, type MultiplayerRealtimeConnection } from '@/lib/multiplayerRealtime';
import { configFromMatch, configPayload, isOlderMatchSnapshot, isParticipantInRoom, mergeMonotonicMatch, opponentFor, participantFor, selectActiveRoomMatch, type MultiplayerRoomConfig } from '@/lib/multiplayerRoom';
import { SOLO_PLAY_ROUTE } from '@/lib/playNavigation';

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
const durations = [60, 90, 120] as const;
const initialConfig: MultiplayerRoomConfig = { mode: 'sprint', game: 'addition', level: 'debutant', duration: 60, questionCount: 30, questionSeconds: 10 };

type AvatarPlayer = Pick<PublicPlayer, 'name' | 'avatarUrl' | 'presenceStatus'>;
type ToastState = { id: number; text: string } | null;

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function bounded(value: string | undefined, fallback: number, min: number, max: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, Math.round(numeric))) : fallback;
}

function configFromParams(params: { mode?: string; game?: string; level?: string; duration?: string; questions?: string; seconds?: string }): MultiplayerRoomConfig {
  const rawDuration = bounded(param(params.duration), 60, 60, 120);
  return {
    mode: param(params.mode) === 'tempo' ? 'tempo' : initialConfig.mode,
    game: operations.some((item) => item.value === param(params.game)) ? param(params.game) as GameType : initialConfig.game,
    level: levels.some((item) => item.value === param(params.level)) ? param(params.level) as GameLevel : initialConfig.level,
    duration: durations.includes(rawDuration as 60 | 90 | 120) ? rawDuration as 60 | 90 | 120 : 60,
    questionCount: bounded(param(params.questions), 30, 10, 50),
    questionSeconds: bounded(param(params.seconds), 10, 5, 30),
  };
}

function playerPresence(status: AvatarPlayer['presenceStatus']) {
  if (status === 'online') return 'En ligne';
  if (status === 'away') return 'Absent';
  return 'Hors ligne';
}

function matchLabel(match: MatchData) {
  const operation = operations.find((item) => item.value === match.game)?.label ?? 'Opération';
  const level = levels.find((item) => item.value === match.level)?.label ?? 'Niveau';
  const timing = match.challengeMode === 'tempo'
    ? `${match.questionCount ?? 30} q · ${match.perQuestionTimeLimitSeconds ?? 10} s/q`
    : `${match.durationSeconds} s`;
  return `${match.challengeMode === 'tempo' ? 'Tempo' : 'Sprint'} · ${operation} · ${level} · ${timing}`;
}

function opponentStatus(match: MatchData, isHost: boolean) {
  if (match.status === 'pending') return isHost ? 'Invitation envoyée' : 'Vous invite';
  if (match.status === 'accepted') return 'Dans le salon';
  if (match.status === 'ready') return isHost ? 'Validation attendue' : 'Défi proposé';
  if (match.status === 'in_progress') return 'En jeu';
  return 'Adversaire';
}

export function MultiplayerScreen() {
  const params = useLocalSearchParams<{ mode?: string; game?: string; level?: string; duration?: string; questions?: string; seconds?: string }>();
  const getToken = useStableToken();
  const connectionRef = useRef<MultiplayerRealtimeConnection | null>(null);
  const joinedRoomRef = useRef<string | null>(null);
  const lastRoomEventIdRef = useRef(new Map<string, string>());
  const roomRevisionRef = useRef(new Map<string, number>());
  const [player, setPlayer] = useState<Player | null>(null);
  const [friends, setFriends] = useState<PublicPlayer[]>([]);
  const [matches, setMatches] = useState<MatchData[]>([]);
  const { objectives, objectivesError, objectivesLoading } = useDailyObjectives(getToken);
  const [config, setConfig] = useState<MultiplayerRoomConfig>(() => configFromParams(params));
  const [loading, setLoading] = useState(true);
  const [realtimeReady, setRealtimeReady] = useState(false);
  const [realtimeGeneration, setRealtimeGeneration] = useState(0);
  const [action, setAction] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [error, setError] = useState<string | null>(null);
  const [friendPickerOpen, setFriendPickerOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const showToast = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 2_800);
    return () => clearTimeout(timer);
  }, [toast]);

  const upsertMatch = useCallback((match: MatchData) => {
    setMatches((current) => {
      const previous = current.find((item) => item.id === match.id);
      if (isOlderMatchSnapshot(previous, match)) return current;
      return [mergeMonotonicMatch(previous, match), ...current.filter((item) => item.id !== match.id)];
    });
  }, []);

  const refresh = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    try {
      const [nextPlayer, overview] = await Promise.all([getCurrentPlayer(getToken), getMatchRoomOverview(getToken)]);
      setPlayer(nextPlayer);
      setFriends(overview.friends);
      setMatches(overview.matches);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Espace multijoueur indisponible.');
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [getToken]);

  useFocusEffect(useCallback(() => {
    void refresh(true);
  }, [refresh]));

  useEffect(() => {
    let active = true;
    void connectMultiplayerRealtime(getToken, {
      onDisconnected: () => { if (active) { joinedRoomRef.current = null; setRealtimeReady(false); } },
      onError: (reason) => { if (active) setError(reason.message); },
      onMatch: (match) => { if (active) upsertMatch(match); },
      onRoomEvent: (event) => {
        if (!active || event.revision <= (roomRevisionRef.current.get(event.roomId) ?? -1)) return;
        roomRevisionRef.current.set(event.roomId, event.revision);
        lastRoomEventIdRef.current.set(event.roomId, event.eventId);
        upsertMatch(event.match);
      },
      onRoomSnapshot: (snapshot) => {
        if (!active || snapshot.revision < (roomRevisionRef.current.get(snapshot.roomId) ?? -1)) return;
        roomRevisionRef.current.set(snapshot.roomId, snapshot.revision);
        upsertMatch(snapshot.match);
      },
      onReady: () => {
        if (!active) return;
        setError(null);
        setRealtimeReady(true);
        setRealtimeGeneration((value) => value + 1);
        void refresh();
      },
      onRefreshRequested: () => { if (active) void refresh(); },
    }).then((connection) => {
      if (!active) return connection.disconnect();
      connectionRef.current = connection;
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Connexion temps réel impossible.');
    });
    return () => {
      active = false;
      connectionRef.current?.disconnect();
      connectionRef.current = null;
      joinedRoomRef.current = null;
    };
  }, [getToken, refresh, upsertMatch]);

  const activeMatch = selectActiveRoomMatch(matches, player?.id);
  const myParticipant = activeMatch ? participantFor(activeMatch, player?.id) : null;
  const opponentParticipant = opponentFor(activeMatch, player?.id);
  const opponent = opponentParticipant?.player ?? null;
  const isHost = Boolean(activeMatch && activeMatch.createdBy.id === player?.id);
  const opponentJoined = isParticipantInRoom(opponentParticipant?.status);
  const canEditConfig = !activeMatch || Boolean(isHost && (activeMatch.status === 'pending' || activeMatch.status === 'accepted'));
  const controlsDisabled = Boolean(action) || !canEditConfig;
  const heartbeatMatchId = activeMatch && isHost && ['pending', 'accepted', 'ready', 'in_progress'].includes(activeMatch.status)
    ? activeMatch.id
    : null;

  useEffect(() => {
    if (activeMatch) setConfig(configFromMatch(activeMatch));
  }, [activeMatch, activeMatch?.configVersion, activeMatch?.id]);

  useEffect(() => {
    if (!realtimeReady || !activeMatch || !connectionRef.current) return;
    const roomId = activeMatch.roomId ?? activeMatch.id;
    if (joinedRoomRef.current === roomId) return;
    joinedRoomRef.current = roomId;
    void connectionRef.current.joinRoom(roomId, lastRoomEventIdRef.current.get(roomId) ?? null).catch((reason) => {
      joinedRoomRef.current = null;
      setError(reason instanceof Error ? reason.message : 'Impossible de rejoindre le salon temps réel.');
    });
  }, [activeMatch, activeMatch?.id, activeMatch?.roomId, realtimeGeneration, realtimeReady]);

  useEffect(() => {
    if (!heartbeatMatchId) return;
    let active = true;
    const beat = async () => {
      try {
        const match = await heartbeatMatch(getToken, heartbeatMatchId);
        if (active) upsertMatch(match);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Synchronisation du salon interrompue.');
      }
    };
    const first = setTimeout(() => void beat(), 750);
    const interval = setInterval(() => void beat(), 5_000);
    return () => { active = false; clearTimeout(first); clearInterval(interval); };
  }, [getToken, heartbeatMatchId, upsertMatch]);

  useEffect(() => {
    if (activeMatch?.status === 'in_progress' || activeMatch?.status === 'completed') {
      router.replace({ pathname: '/multiplayer/[matchId]', params: { matchId: activeMatch.id } });
    }
  }, [activeMatch?.id, activeMatch?.status]);

  const requireConnection = () => {
    if (!connectionRef.current || !realtimeReady) throw new Error('Connexion temps réel du salon indisponible.');
    return connectionRef.current;
  };

  const changeConfig = async (next: MultiplayerRoomConfig) => {
    if (controlsDisabled) return;
    const previous = config;
    setConfig(next);
    if (!activeMatch) return;
    setAction('config');
    setError(null);
    try {
      const response = await requireConnection().updateConfig(activeMatch.id, configPayload(next, activeMatch.configVersion));
      upsertMatch(response.match);
      showToast(opponentJoined ? 'Configuration mise à jour pour les deux joueurs.' : 'Configuration enregistrée dans le salon.');
    } catch (reason) {
      setConfig(previous);
      setError(reason instanceof Error ? reason.message : 'Configuration impossible.');
      await refresh();
    } finally {
      setAction(null);
    }
  };

  const invite = async (friend: PublicPlayer) => {
    setAction(`invite:${friend.id}`);
    setError(null);
    try {
      const response = await requireConnection().createInvitation({ opponentPlayerId: friend.id, ...configPayload(config) });
      upsertMatch(response.match);
      setFriendPickerOpen(false);
      showToast(`Invitation envoyée à ${friend.name}.`);
    } catch (reason) {
      setFriendPickerOpen(false);
      setError(reason instanceof Error ? reason.message : 'Impossible d’envoyer le défi.');
    } finally {
      setAction(null);
    }
  };

  const acceptInvitation = async () => {
    if (!activeMatch) return;
    setAction('accept-invitation'); setError(null);
    try {
      const response = await requireConnection().acceptInvitation(activeMatch.id);
      upsertMatch(response.match);
      showToast('Tu es entré dans le salon. Le maître peut maintenant préparer le défi.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible d’entrer dans le salon.'); }
    finally { setAction(null); }
  };

  const declineInvitation = async () => {
    if (!activeMatch) return;
    setAction('decline-invitation'); setError(null);
    try {
      const response = await requireConnection().declineInvitation(activeMatch.id);
      upsertMatch(response.match);
      showToast('Invitation refusée.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible de refuser cette invitation.'); }
    finally { setAction(null); }
  };

  const closeRoom = async () => {
    if (!activeMatch) return;
    setAction('leave'); setError(null);
    try {
      const response = await requireConnection().leave(activeMatch.id);
      upsertMatch(response.match);
      setCancelConfirmOpen(false);
      showToast('Salon fermé. Tu peux choisir un autre adversaire.');
    } catch (reason) {
      setCancelConfirmOpen(false);
      setError(reason instanceof Error ? reason.message : 'Impossible de fermer ce salon.');
    } finally { setAction(null); }
  };

  const propose = async () => {
    if (!activeMatch || !isHost || !opponentJoined) return;
    setAction('propose'); setError(null);
    try {
      const response = await requireConnection().propose(activeMatch.id, configPayload(config, activeMatch.configVersion));
      upsertMatch(response.match);
      showToast('Défi proposé. L’adversaire doit maintenant valider cette configuration.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible de proposer ce défi.'); }
    finally { setAction(null); }
  };

  const acceptProposal = async () => {
    if (!activeMatch) return;
    setAction('accept-proposal'); setError(null);
    try {
      const response = await requireConnection().acceptProposal(activeMatch.id);
      upsertMatch(response.match);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible d’accepter ce défi.'); }
    finally { setAction(null); }
  };

  const declineProposal = async () => {
    if (!activeMatch) return;
    setAction('decline-proposal'); setError(null);
    try {
      const response = await requireConnection().declineProposal(activeMatch.id);
      upsertMatch(response.match);
      showToast('Proposition refusée. Le maître peut modifier la configuration.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Impossible de refuser cette proposition.'); }
    finally { setAction(null); }
  };

  const currentAvatar: AvatarPlayer = {
    avatarUrl: player?.avatarUrl ?? null,
    name: player?.name ?? 'Moi',
    presenceStatus: player?.presenceStatus ?? 'online',
  };
  const incomingPending = Boolean(activeMatch && !isHost && activeMatch.status === 'pending' && myParticipant?.status === 'invited');
  const prepareObjective = (objective: DailyObjective) => {
    const objectiveConfig = objective.launchConfig;
    if (objectiveConfig.playContext === 'solo') {
      router.replace(SOLO_PLAY_ROUTE);
      return;
    }
    const objectiveDuration = objectiveConfig.sprintDurationSeconds ?? config.duration;
    setConfig({
      mode: objectiveConfig.challengeMode,
      game: objectiveConfig.game,
      level: objectiveConfig.level,
      duration: durations.includes(objectiveDuration as 60 | 90 | 120) ? objectiveDuration as 60 | 90 | 120 : 60,
      questionCount: objectiveConfig.tempoQuestionCount ?? config.questionCount,
      questionSeconds: objectiveConfig.tempoQuestionSeconds ?? config.questionSeconds,
    });
    showToast(`Configuration préparée pour « ${objective.title} ».`);
  };

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <AppHeader />
    {!activeMatch ? <DailyObjectives error={objectivesError} loading={objectivesLoading} objectives={objectives} onPrepare={prepareObjective} /> : null}
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <PlayContextSwitch active="multiplayer" onChange={(next) => { if (next === 'solo') router.replace(SOLO_PLAY_ROUTE); }} />

      <View style={styles.arenaHeader}>
        <ProfileSlot label={player?.name ?? 'Moi'} player={currentAvatar} status={activeMatch ? (isHost ? 'Maître du salon' : 'Dans le défi') : undefined} />
        <View style={styles.arenaCopy}>
          <Text style={styles.eyebrow}>ARÈNE MAYELE</Text>
          <Text style={styles.title}>Défier un ami</Text>
          <View style={styles.vsLine}><View style={styles.vsRule} /><Text style={styles.vsText}>VS</Text><View style={styles.vsRule} /></View>
          <View style={[styles.liveBadge, realtimeReady ? styles.liveBadgeReady : null]}><View style={[styles.liveDot, realtimeReady ? styles.liveDotReady : null]} /><Text style={styles.liveText}>{realtimeReady ? 'Salon synchronisé' : 'Connexion…'}</Text></View>
        </View>
        {opponent && activeMatch ? (
          <ProfileSlot label={opponent.name} player={opponent} status={opponentStatus(activeMatch, isHost)} />
        ) : (
          <AddOpponentButton disabled={loading || Boolean(action) || !realtimeReady} onPress={() => setFriendPickerOpen(true)} />
        )}
      </View>

      {activeMatch && opponent ? <RoomStateCard
        action={action}
        incomingPending={incomingPending}
        isHost={isHost}
        match={activeMatch}
        onAcceptInvitation={() => void acceptInvitation()}
        onAcceptProposal={() => void acceptProposal()}
        onCancel={() => setCancelConfirmOpen(true)}
        onDeclineInvitation={() => void declineInvitation()}
        onDeclineProposal={() => void declineProposal()}
        onPropose={() => void propose()}
        opponentJoined={opponentJoined}
      /> : null}

      <View style={[styles.configCard, !canEditConfig && styles.configCardLocked]}>
        <View style={styles.configTitleRow}>
          <Text style={styles.sectionTitle}>Configuration du défi</Text>
          {!canEditConfig ? <View style={styles.lockBadge}><Ionicons color="#617783" name="lock-closed" size={12} /><Text style={styles.lockText}>{activeMatch?.status === 'ready' ? 'Proposée' : 'Lecture seule'}</Text></View> : null}
        </View>
        <View style={styles.twoColumns}>
          <Choice active={config.mode === 'sprint'} disabled={controlsDisabled} label="Sprint" onPress={() => void changeConfig({ ...config, mode: 'sprint' })} />
          <Choice active={config.mode === 'tempo'} disabled={controlsDisabled} label="Tempo" onPress={() => void changeConfig({ ...config, mode: 'tempo' })} />
        </View>
        {config.mode === 'sprint'
          ? <View style={styles.optionRow}>{durations.map((value) => <Choice key={value} active={config.duration === value} disabled={controlsDisabled} label={`${value} s`} onPress={() => void changeConfig({ ...config, duration: value })} />)}</View>
          : <View style={styles.twoColumns}><Stepper disabled={controlsDisabled} label="Questions" min={10} max={50} step={5} value={config.questionCount} onChange={(value) => void changeConfig({ ...config, questionCount: value })} /><Stepper disabled={controlsDisabled} label="Secondes / q" min={5} max={30} step={1} value={config.questionSeconds} onChange={(value) => void changeConfig({ ...config, questionSeconds: value })} /></View>}
        <Text style={styles.optionLabel}>OPÉRATION</Text>
        <View style={styles.optionRow}>{operations.map((item) => <Choice key={item.value} active={config.game === item.value} compact disabled={controlsDisabled} label={item.label} mixed={item.value === 'mixte'} onPress={() => void changeConfig({ ...config, game: item.value })} />)}</View>
        <Text style={styles.optionLabel}>NIVEAU</Text>
        <View style={styles.levelGrid}>{levels.map((item) => <Choice key={item.value} active={config.level === item.value} disabled={controlsDisabled} label={item.label} onPress={() => void changeConfig({ ...config, level: item.value })} />)}</View>
        {action === 'config' ? <View style={styles.syncRow}><ActivityIndicator color="#0b9f8f" size="small" /><Text style={styles.syncText}>Mise à jour du salon…</Text></View> : null}
      </View>

      {error ? <View style={styles.errorBox}><Ionicons color="#a54238" name="alert-circle-outline" size={19} /><Text style={styles.errorText}>{error}</Text></View> : null}
    </ScrollView>

    {toast ? <View accessibilityLiveRegion="polite" style={styles.toast}><Ionicons color="#fff" name="checkmark-circle" size={19} /><Text style={styles.toastText}>{toast.text}</Text></View> : null}

    <FriendPickerModal action={action} friends={friends} loading={loading} onClose={() => setFriendPickerOpen(false)} onInvite={invite} open={friendPickerOpen} />
    <CancelInvitationModal busy={action === 'leave'} isPending={activeMatch?.status === 'pending'} onCancel={() => setCancelConfirmOpen(false)} onConfirm={() => void closeRoom()} open={cancelConfirmOpen} opponentName={opponent?.name ?? 'cet adversaire'} />
  </SafeAreaView>;
}

function RoomStateCard({ action, incomingPending, isHost, match, onAcceptInvitation, onAcceptProposal, onCancel, onDeclineInvitation, onDeclineProposal, onPropose, opponentJoined }: {
  action: string | null; incomingPending: boolean; isHost: boolean; match: MatchData;
  onAcceptInvitation: () => void; onAcceptProposal: () => void; onCancel: () => void; onDeclineInvitation: () => void; onDeclineProposal: () => void; onPropose: () => void; opponentJoined: boolean;
}) {
  let title = 'Invitation envoyée';
  let description = 'En attente de l’entrée de l’adversaire dans le salon.';
  if (incomingPending) { title = `${match.createdBy.name} t’invite`; description = 'Entre dans le salon pour consulter la configuration et préparer le défi.'; }
  else if (match.status === 'accepted' && isHost) { title = 'Les deux joueurs sont dans le salon'; description = 'Tu peux modifier la configuration, puis proposer le défi.'; }
  else if (match.status === 'accepted') { title = 'Tu es dans le salon'; description = 'Le maître du salon prépare la configuration.'; }
  else if (match.status === 'ready' && isHost) { title = 'Défi proposé'; description = 'En attente de la validation de l’adversaire.'; }
  else if (match.status === 'ready') { title = 'Configuration proposée'; description = 'Vérifie les règles ci-dessous avant de lancer la partie.'; }

  return <View style={styles.roomCard}>
    <View style={styles.roomCardHeading}><View style={styles.roomCardCopy}><Text style={styles.roomTitle}>{title}</Text><Text style={styles.roomDescription}>{description}</Text><Text style={styles.roomDetails}>{matchLabel(match)}</Text></View>{!incomingPending ? <Pressable disabled={Boolean(action)} onPress={onCancel} style={styles.cancelButton}><Ionicons color="#9b3931" name="close-circle-outline" size={17} /><Text style={styles.cancelButtonText}>{match.status === 'pending' ? 'Annuler' : 'Quitter'}</Text></Pressable> : null}</View>
    {incomingPending ? <View style={styles.actionRow}><ActionButton busy={action === 'accept-invitation'} label="Entrer dans le salon" onPress={onAcceptInvitation} /><SecondaryButton disabled={Boolean(action)} label="Refuser" onPress={onDeclineInvitation} /></View> : null}
    {match.status === 'accepted' && isHost ? <ActionButton busy={action === 'propose'} disabled={!opponentJoined} label={opponentJoined ? 'Proposer le défi' : 'En attente de l’adversaire'} onPress={onPropose} /> : null}
    {match.status === 'ready' && !isHost ? <View style={styles.actionRow}><ActionButton busy={action === 'accept-proposal'} label="Accepter le défi" onPress={onAcceptProposal} /><SecondaryButton disabled={Boolean(action)} label="Modifier" onPress={onDeclineProposal} /></View> : null}
  </View>;
}

function ActionButton({ busy, disabled, label, onPress }: { busy?: boolean; disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable disabled={busy || disabled} onPress={onPress} style={[styles.primaryAction, (busy || disabled) && styles.disabled]}>{busy ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryActionText}>{label}</Text><Ionicons color="#fff" name="arrow-forward" size={18} /></>}</Pressable>;
}

function SecondaryButton({ disabled, label, onPress }: { disabled?: boolean; label: string; onPress: () => void }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.secondaryAction, disabled && styles.disabled]}><Text style={styles.secondaryActionText}>{label}</Text></Pressable>;
}

function ProfileSlot({ label, player, status }: { label: string; player: AvatarPlayer; status?: string }) {
  return <View style={styles.profileSlot}><Avatar player={player} size="large" /><Text numberOfLines={1} style={styles.profileName}>{label}</Text><Text numberOfLines={2} style={styles.profileStatus}>{status ?? playerPresence(player.presenceStatus)}</Text></View>;
}

function AddOpponentButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  return <Pressable accessibilityLabel="Choisir un adversaire" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.profileSlot, pressed && styles.pressed, disabled && styles.disabled]}><View style={styles.addAvatar}><Ionicons color="#0b9f8f" name="add" size={31} /></View><Text style={styles.profileName}>Adversaire</Text><Text style={styles.profileStatus}>Choisir</Text></Pressable>;
}

function Avatar({ player, size = 'small' }: { player: AvatarPlayer; size?: 'small' | 'large' }) {
  const initials = player.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  const large = size === 'large';
  return <View style={[styles.avatar, large && styles.avatarLarge]}>{player.avatarUrl ? <Image source={{ uri: player.avatarUrl }} style={[styles.avatarImage, large && styles.avatarImageLarge]} /> : <Text style={[styles.avatarText, large && styles.avatarTextLarge]}>{initials}</Text>}<View style={[styles.presence, player.presenceStatus === 'online' && styles.online, player.presenceStatus === 'away' && styles.away]} /></View>;
}

function FriendPickerModal({ action, friends, loading, onClose, onInvite, open }: { action: string | null; friends: PublicPlayer[]; loading: boolean; onClose: () => void; onInvite: (friend: PublicPlayer) => Promise<void>; open: boolean }) {
  return <Modal animationType="slide" onRequestClose={onClose} presentationStyle="pageSheet" visible={open}><SafeAreaView edges={['top', 'bottom']} style={styles.pickerSafe}><View style={styles.pickerHeader}><View><Text style={styles.pickerEyebrow}>NOUVEAU SALON</Text><Text style={styles.pickerTitle}>Choisir un adversaire</Text></View><Pressable accessibilityLabel="Fermer" onPress={onClose} style={styles.closeButton}><Ionicons color="#173246" name="close" size={23} /></Pressable></View><Text style={styles.pickerIntro}>L’ami recevra une invitation. La configuration restera modifiable après son entrée dans le salon.</Text><ScrollView contentContainerStyle={styles.pickerList}>{loading && !friends.length ? <ActivityIndicator color="#0b9f8f" size="large" /> : friends.map((friend) => <Pressable disabled={Boolean(action)} key={friend.id} onPress={() => void onInvite(friend)} style={({ pressed }) => [styles.friendCard, pressed && styles.pressed, Boolean(action) && styles.disabled]}><Avatar player={friend} /><View style={styles.friendCopy}><Text style={styles.friendName}>{friend.name}</Text><Text style={styles.friendDetails}>{friend.username ? `@${friend.username} · ` : ''}{playerPresence(friend.presenceStatus)}</Text></View>{action === `invite:${friend.id}` ? <ActivityIndicator color="#0b9f8f" /> : <View style={styles.selectFriendIcon}><Ionicons color="#0b9f8f" name="arrow-forward" size={18} /></View>}</Pressable>)}{!friends.length && !loading ? <View style={styles.emptyCard}><Ionicons color="#71858f" name="people-outline" size={27} /><Text style={styles.empty}>Ajoute d’abord un ami depuis l’onglet Amis.</Text></View> : null}</ScrollView></SafeAreaView></Modal>;
}

function CancelInvitationModal({ busy, isPending, onCancel, onConfirm, open, opponentName }: { busy: boolean; isPending?: boolean; onCancel: () => void; onConfirm: () => void; open: boolean; opponentName: string }) {
  return <Modal animationType="fade" onRequestClose={onCancel} transparent visible={open}><View style={styles.confirmBackdrop}><View accessibilityViewIsModal style={styles.confirmCard}><View style={styles.confirmIcon}><Ionicons color="#a33d35" name="close-circle-outline" size={27} /></View><Text style={styles.confirmTitle}>{isPending ? 'Annuler l’invitation ?' : 'Quitter le salon ?'}</Text><Text style={styles.confirmText}>Le salon avec {opponentName} sera fermé pour les deux joueurs. Tu pourras ensuite choisir une autre configuration ou un autre adversaire.</Text><View style={styles.confirmActions}><Pressable disabled={busy} onPress={onCancel} style={styles.keepButton}><Text style={styles.keepButtonText}>Garder</Text></Pressable><Pressable disabled={busy} onPress={onConfirm} style={styles.confirmCancelButton}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmCancelText}>{isPending ? 'Annuler l’invitation' : 'Quitter le salon'}</Text>}</Pressable></View></View></View></Modal>;
}

function Choice({ active, compact, disabled, label, mixed, onPress }: { active: boolean; compact?: boolean; disabled?: boolean; label: string; mixed?: boolean; onPress: () => void }) {
  return <Pressable accessibilityLabel={mixed ? 'Mixte, toutes les opérations' : label} accessibilityRole="button" accessibilityState={{ disabled, selected: active }} disabled={disabled} onPress={onPress} style={[styles.choice, compact && styles.compactChoice, active && styles.activeChoice, disabled && styles.choiceDisabled]}>{mixed ? <MixedIcon active={active} /> : <Text numberOfLines={1} style={[styles.choiceText, active && styles.activeChoiceText]}>{label}</Text>}</Pressable>;
}

function MixedIcon({ active }: { active: boolean }) {
  return <View style={[styles.mixedGrid, active && styles.mixedGridActive]}>{['+', '−', '×', '÷'].map((operator, index) => <View key={operator} style={[styles.mixedCell, index % 2 === 0 && styles.mixedCellRight, index < 2 && styles.mixedCellBottom]}><Text style={[styles.mixedOperator, active && styles.activeChoiceText]}>{operator}</Text></View>)}</View>;
}

function Stepper({ disabled, label, value, min, max, step, onChange }: { disabled?: boolean; label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <View style={[styles.stepper, disabled && styles.choiceDisabled]}><Text style={styles.stepperLabel}>{label}</Text><View style={styles.stepperRow}><Pressable disabled={disabled || value <= min} onPress={() => onChange(Math.max(min, value - step))} style={styles.stepperButton}><Ionicons color="#173246" name="remove" size={17} /></Pressable><Text style={styles.stepperValue}>{value}</Text><Pressable disabled={disabled || value >= max} onPress={() => onChange(Math.min(max, value + step))} style={styles.stepperButton}><Ionicons color="#173246" name="add" size={17} /></Pressable></View></View>;
}

const styles = StyleSheet.create({
  safe: { backgroundColor: '#f3f8f7', flex: 1 }, content: { gap: 10, paddingBottom: 22, paddingHorizontal: 10 },
  arenaHeader: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, minHeight: 119 }, arenaCopy: { alignItems: 'center', flex: 1, paddingHorizontal: 2, paddingTop: 12 }, eyebrow: { color: '#0b9f8f', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, textAlign: 'center' }, title: { color: '#102a3e', fontSize: 20, fontWeight: '900', marginTop: 3, textAlign: 'center' }, vsLine: { alignItems: 'center', flexDirection: 'row', gap: 5, marginTop: 7, width: '78%' }, vsRule: { backgroundColor: '#bddbd7', flex: 1, height: 1 }, vsText: { color: '#70838d', fontSize: 9, fontWeight: '900' },
  liveBadge: { alignItems: 'center', backgroundColor: '#edf1f2', borderRadius: 8, flexDirection: 'row', gap: 4, marginTop: 6, paddingHorizontal: 6, paddingVertical: 3 }, liveBadgeReady: { backgroundColor: '#e7f7f3' }, liveDot: { backgroundColor: '#8b9aa1', borderRadius: 3, height: 6, width: 6 }, liveDotReady: { backgroundColor: '#23b36b' }, liveText: { color: '#637781', fontSize: 7, fontWeight: '800' },
  profileSlot: { alignItems: 'center', minHeight: 108, paddingTop: 3, width: 84 }, profileName: { color: '#173246', fontSize: 10, fontWeight: '900', marginTop: 5, maxWidth: 82, textAlign: 'center' }, profileStatus: { color: '#6c7e88', fontSize: 8, lineHeight: 10, marginTop: 2, maxWidth: 84, textAlign: 'center' }, addAvatar: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#92cdc4', borderRadius: 29, borderStyle: 'dashed', borderWidth: 1.5, height: 58, justifyContent: 'center', width: 58 },
  roomCard: { backgroundColor: '#edf9f6', borderColor: '#b8ded8', borderRadius: 15, borderWidth: 1, gap: 10, padding: 11 }, roomCardHeading: { alignItems: 'center', flexDirection: 'row', gap: 8 }, roomCardCopy: { flex: 1 }, roomTitle: { color: '#087f73', fontSize: 13, fontWeight: '900' }, roomDescription: { color: '#4f6873', fontSize: 10, lineHeight: 14, marginTop: 2 }, roomDetails: { color: '#71858d', fontSize: 8, lineHeight: 12, marginTop: 4 }, cancelButton: { alignItems: 'center', backgroundColor: '#fff4f2', borderColor: '#f0cbc7', borderRadius: 10, borderWidth: 1, flexDirection: 'row', gap: 4, minHeight: 34, paddingHorizontal: 8 }, cancelButtonText: { color: '#9b3931', fontSize: 9, fontWeight: '900' }, actionRow: { flexDirection: 'row', gap: 7 }, primaryAction: { alignItems: 'center', backgroundColor: '#0b9f8f', borderRadius: 11, flex: 1, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 43, paddingHorizontal: 11 }, primaryActionText: { color: '#fff', fontSize: 11, fontWeight: '900', textAlign: 'center' }, secondaryAction: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#c8dfdc', borderRadius: 11, borderWidth: 1, justifyContent: 'center', minHeight: 43, paddingHorizontal: 15 }, secondaryActionText: { color: '#405966', fontSize: 10, fontWeight: '900' },
  configCard: { backgroundColor: '#fff', borderColor: '#d1e5e4', borderRadius: 18, borderWidth: 1, gap: 8, padding: 12 }, configCardLocked: { backgroundColor: '#fbfdfd' }, configTitleRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' }, sectionTitle: { color: '#173246', fontSize: 14, fontWeight: '900' }, lockBadge: { alignItems: 'center', backgroundColor: '#edf3f3', borderRadius: 9, flexDirection: 'row', gap: 4, paddingHorizontal: 7, paddingVertical: 4 }, lockText: { color: '#617783', fontSize: 8, fontWeight: '800' }, optionLabel: { color: '#435966', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginTop: 2 }, twoColumns: { flexDirection: 'row', gap: 7 }, optionRow: { flexDirection: 'row', gap: 6 }, levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  choice: { alignItems: 'center', backgroundColor: '#f8fbfb', borderColor: '#cfe3e4', borderRadius: 12, borderWidth: 1, flex: 1, height: 38, justifyContent: 'center', minWidth: 60, paddingHorizontal: 7 }, compactChoice: { minWidth: 42, paddingHorizontal: 3 }, activeChoice: { backgroundColor: '#0b9f8f', borderColor: '#0b9f8f' }, choiceDisabled: { opacity: 0.68 }, choiceText: { color: '#263e4d', fontSize: 11, fontWeight: '900' }, activeChoiceText: { color: '#fff' }, mixedGrid: { borderColor: '#173246', borderRadius: 3, borderWidth: 1, flexDirection: 'row', flexWrap: 'wrap', height: 24, overflow: 'hidden', width: 28 }, mixedGridActive: { borderColor: '#fff' }, mixedCell: { alignItems: 'center', height: '50%', justifyContent: 'center', width: '50%' }, mixedCellRight: { borderRightColor: '#8aa0aa', borderRightWidth: StyleSheet.hairlineWidth }, mixedCellBottom: { borderBottomColor: '#8aa0aa', borderBottomWidth: StyleSheet.hairlineWidth }, mixedOperator: { color: '#173246', fontSize: 7, fontWeight: '900', lineHeight: 9 },
  stepper: { backgroundColor: '#f8fbfb', borderColor: '#d4e7e8', borderRadius: 12, borderWidth: 1, flex: 1, padding: 8 }, stepperLabel: { color: '#435966', fontSize: 9, fontWeight: '900', textAlign: 'center' }, stepperRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }, stepperButton: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#d2e3e5', borderRadius: 9, borderWidth: 1, height: 29, justifyContent: 'center', width: 29 }, stepperValue: { color: '#173246', fontSize: 15, fontWeight: '900' }, syncRow: { alignItems: 'center', flexDirection: 'row', gap: 7, justifyContent: 'center', paddingTop: 2 }, syncText: { color: '#087f73', fontSize: 9, fontWeight: '800' },
  avatar: { alignItems: 'center', backgroundColor: '#dff3ef', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 }, avatarLarge: { borderRadius: 29, height: 58, width: 58 }, avatarImage: { borderRadius: 20, height: 40, width: 40 }, avatarImageLarge: { borderRadius: 29, height: 58, width: 58 }, avatarText: { color: '#087f73', fontSize: 12, fontWeight: '900' }, avatarTextLarge: { fontSize: 16 }, presence: { backgroundColor: '#9aa8ae', borderColor: '#fff', borderRadius: 5, borderWidth: 2, bottom: 0, height: 10, position: 'absolute', right: 0, width: 10 }, online: { backgroundColor: '#2bbf72' }, away: { backgroundColor: '#e6a23c' },
  toast: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#087f73', borderRadius: 22, bottom: 14, elevation: 8, flexDirection: 'row', gap: 8, maxWidth: '92%', paddingHorizontal: 16, paddingVertical: 11, position: 'absolute', shadowColor: '#092f2b', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 10 }, toastText: { color: '#fff', flexShrink: 1, fontSize: 11, fontWeight: '800', lineHeight: 16 }, errorBox: { backgroundColor: '#fff0ee', borderRadius: 12, flexDirection: 'row', gap: 8, padding: 10 }, errorText: { color: '#91382f', flex: 1, fontSize: 11, lineHeight: 16 },
  pickerSafe: { backgroundColor: '#f3f8f7', flex: 1 }, pickerHeader: { alignItems: 'center', backgroundColor: '#fff', borderBottomColor: '#dce9e8', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 }, pickerEyebrow: { color: '#0b9f8f', fontSize: 9, fontWeight: '900', letterSpacing: 1.8 }, pickerTitle: { color: '#173246', fontSize: 23, fontWeight: '900', marginTop: 2 }, closeButton: { alignItems: 'center', backgroundColor: '#f2f7f7', borderRadius: 19, height: 38, justifyContent: 'center', width: 38 }, pickerIntro: { color: '#607681', fontSize: 12, lineHeight: 18, padding: 18 }, pickerList: { gap: 9, paddingBottom: 24, paddingHorizontal: 14 }, friendCard: { alignItems: 'center', backgroundColor: '#fff', borderColor: '#d7e8e7', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 11, padding: 11 }, friendCopy: { flex: 1 }, friendName: { color: '#173246', fontSize: 13, fontWeight: '900' }, friendDetails: { color: '#667b86', fontSize: 10, lineHeight: 14, marginTop: 2 }, selectFriendIcon: { alignItems: 'center', backgroundColor: '#e6f7f3', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 }, emptyCard: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 15, gap: 8, padding: 24 }, empty: { color: '#71858f', fontSize: 12, textAlign: 'center' },
  confirmBackdrop: { alignItems: 'center', backgroundColor: 'rgba(10,31,43,0.48)', flex: 1, justifyContent: 'center', padding: 22 }, confirmCard: { alignItems: 'center', backgroundColor: '#fff', borderRadius: 20, maxWidth: 360, padding: 20, width: '100%' }, confirmIcon: { alignItems: 'center', backgroundColor: '#fff0ee', borderRadius: 24, height: 48, justifyContent: 'center', width: 48 }, confirmTitle: { color: '#173246', fontSize: 20, fontWeight: '900', marginTop: 12 }, confirmText: { color: '#627782', fontSize: 12, lineHeight: 18, marginTop: 7, textAlign: 'center' }, confirmActions: { flexDirection: 'row', gap: 8, marginTop: 18, width: '100%' }, keepButton: { alignItems: 'center', backgroundColor: '#eef4f4', borderRadius: 11, flex: 1, justifyContent: 'center', minHeight: 45 }, keepButtonText: { color: '#405966', fontSize: 11, fontWeight: '900' }, confirmCancelButton: { alignItems: 'center', backgroundColor: '#a54238', borderRadius: 11, flex: 1.45, justifyContent: 'center', minHeight: 45, paddingHorizontal: 8 }, confirmCancelText: { color: '#fff', fontSize: 10, fontWeight: '900', textAlign: 'center' },
  disabled: { opacity: 0.55 }, pressed: { opacity: 0.72 },
});

export default MultiplayerScreen;
