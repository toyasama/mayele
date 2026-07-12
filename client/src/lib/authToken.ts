type TokenProvider = () => Promise<string | null>

const AUTH_TOKEN_WAIT_MS = 5_000
const AUTH_TOKEN_RETRY_MS = 100

export async function waitForAuthToken(getToken: TokenProvider) {
  const startedAt = Date.now()
  let token = await getToken()

  while (!token && Date.now() - startedAt < AUTH_TOKEN_WAIT_MS) {
    await new Promise((resolve) => window.setTimeout(resolve, AUTH_TOKEN_RETRY_MS))
    token = await getToken()
  }

  return token
}
