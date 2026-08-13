import { useFocusEffect } from 'expo-router';
import { useCallback, useSyncExternalStore } from 'react';

import { getDailyObjectives, type DailyObjective, type TokenProvider } from '@/lib/api';

const CACHE_TTL_MS = 60_000;

type ObjectivesSnapshot = {
  data: DailyObjective[];
  error: string | null;
  loading: boolean;
  updatedAt: number;
};

let snapshot: ObjectivesSnapshot = { data: [], error: null, loading: false, updatedAt: 0 };
let request: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: ObjectivesSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

async function refresh(getToken: TokenProvider, force = false) {
  if (!force && snapshot.updatedAt && Date.now() - snapshot.updatedAt < CACHE_TTL_MS) return;
  if (request) return request;

  publish({ ...snapshot, error: null, loading: snapshot.data.length === 0 });
  request = getDailyObjectives(getToken)
    .then((data) => publish({ data, error: null, loading: false, updatedAt: Date.now() }))
    .catch(() => publish({ ...snapshot, error: 'Objectifs indisponibles pour le moment.', loading: false }))
    .finally(() => { request = null; });
  return request;
}

export function useDailyObjectives(getToken: TokenProvider) {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useFocusEffect(useCallback(() => {
    void refresh(getToken);
  }, [getToken]));

  return {
    objectives: state.data,
    objectivesError: state.error,
    objectivesLoading: state.loading,
    refreshObjectives: () => refresh(getToken, true),
  };
}

export function invalidateDailyObjectives() {
  snapshot = { ...snapshot, updatedAt: 0 };
}
