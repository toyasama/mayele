export type MobileConfig = { apiBaseUrl: string; clerkPublishableKey: string; realtimeBaseUrl: string };

function normalized(value: string | undefined) {
  return value?.trim().replace(/\/$/, '') ?? '';
}

export function readMobileConfig(environment: Record<string, string | undefined> = process.env): MobileConfig {
  const apiBaseUrl = normalized(environment.EXPO_PUBLIC_API_URL);
  const clerkPublishableKey = normalized(environment.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!apiBaseUrl) throw new Error('EXPO_PUBLIC_API_URL manque dans mobile/.env.local.');
  if (!clerkPublishableKey || !/^pk_(test|live)_/.test(clerkPublishableKey)) {
    throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY manque ou est invalide.');
  }

  let apiUrl: URL;
  try { apiUrl = new URL(apiBaseUrl); } catch { throw new Error('EXPO_PUBLIC_API_URL doit être une URL HTTP(S) valide.'); }
  const apiHost = apiUrl.hostname;
  const realtimeBaseUrl = normalized(environment.EXPO_PUBLIC_REALTIME_URL) || apiUrl.origin;
  let realtimeHost = '';
  try { realtimeHost = new URL(realtimeBaseUrl).hostname; } catch { throw new Error('EXPO_PUBLIC_REALTIME_URL doit être une URL HTTP(S) valide.'); }
  const isLocalApi = apiHost === 'localhost' || apiHost === '127.0.0.1' || apiHost.startsWith('10.') ||
    apiHost.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(apiHost);
  const isLocalRealtime = realtimeHost === 'localhost' || realtimeHost === '127.0.0.1' || realtimeHost.startsWith('10.') ||
    realtimeHost.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(realtimeHost);
  if (!isLocalApi && clerkPublishableKey.startsWith('pk_test_')) {
    throw new Error("L’API distante ne doit pas être appelée avec une clé Clerk de test.");
  }
  if (isLocalApi !== isLocalRealtime) {
    throw new Error('L’API et le temps réel doivent utiliser le même environnement local ou distant.');
  }
  return { apiBaseUrl, clerkPublishableKey, realtimeBaseUrl };
}

export function getMobileConfigResult() {
  try { return { config: readMobileConfig(), error: null } as const; }
  catch (error) { return { config: null, error: error instanceof Error ? error.message : 'Configuration invalide.' } as const; }
}
