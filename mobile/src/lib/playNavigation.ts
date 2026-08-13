export const SOLO_PLAY_ROUTE = '/(tabs)/play' as const;

export const MULTIPLAYER_PLAY_ROUTE = {
  pathname: '/(tabs)/play',
  params: { context: 'multiplayer' },
} as const;
