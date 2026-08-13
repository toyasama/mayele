import { describe, expect, it } from 'vitest';

import { readMobileConfig } from './config';

describe('readMobileConfig', () => {
  it('accepte une API locale avec une clé Clerk test', () => {
    expect(readMobileConfig({
      EXPO_PUBLIC_API_URL: 'http://192.168.1.42:4000/api/',
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    })).toEqual({
      apiBaseUrl: 'http://192.168.1.42:4000/api',
      clerkPublishableKey: 'pk_test_example',
      realtimeBaseUrl: 'http://192.168.1.42:4000',
    });
  });

  it('refuse une API distante avec une clé Clerk test', () => {
    expect(() => readMobileConfig({
      EXPO_PUBLIC_API_URL: 'https://mayele.example/api',
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    })).toThrow('clé Clerk de test');
  });

  it('accepte une API distante avec une clé Clerk live', () => {
    expect(readMobileConfig({
      EXPO_PUBLIC_API_URL: 'https://mayele.example/api',
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_example',
    }).apiBaseUrl).toBe('https://mayele.example/api');
  });

  it('refuse de mélanger une API locale et un serveur temps réel distant', () => {
    expect(() => readMobileConfig({
      EXPO_PUBLIC_API_URL: 'http://192.168.1.42:4000/api',
      EXPO_PUBLIC_REALTIME_URL: 'https://api.mayele-learning.com',
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_example',
    })).toThrow('même environnement');
  });

  it('signale les variables manquantes', () => {
    expect(() => readMobileConfig({})).toThrow('EXPO_PUBLIC_API_URL');
  });
});
