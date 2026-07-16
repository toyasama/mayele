export function e2eClientEnvironment(apiUrl: string) {
  return {
    ...process.env,
    VITE_API_URL: `${apiUrl}/api`,
    VITE_REALTIME_URL: apiUrl,
  }
}
