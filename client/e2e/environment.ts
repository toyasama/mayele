export function e2eClientEnvironment(apiUrl: string) {
  return {
    ...process.env,
    // Vite's development server needs this runtime for React Refresh.
    NODE_ENV: 'development',
    VITE_API_URL: `${apiUrl}/api`,
    VITE_REALTIME_URL: apiUrl,
    VITE_E2E_AUTH_BYPASS: 'true',
  }
}
