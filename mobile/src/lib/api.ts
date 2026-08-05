export type Player = {
  id: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string | null;
  profileComplete: boolean;
};

type TokenProvider = () => Promise<string | null>;

const configuredApiBase = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');

export const apiBaseLabel = configuredApiBase ?? 'EXPO_PUBLIC_API_URL non configurée';

export async function getCurrentPlayer(getToken: TokenProvider): Promise<Player> {
  if (!configuredApiBase) {
    throw new Error('Ajoute EXPO_PUBLIC_API_URL dans mobile/.env.local.');
  }

  const token = await getToken();

  if (!token) {
    throw new Error('La session Clerk est active, mais aucun jeton API n’est encore disponible.');
  }

  const response = await fetch(`${configuredApiBase}/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `L’API Mayele a répondu ${response.status}.`);
  }

  const payload = await response.json() as { user: Player };
  return payload.user;
}
