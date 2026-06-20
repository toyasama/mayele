import { createApp } from './app.js'
import { assertProductionEnv, env } from './config/env.js'

assertProductionEnv()

const app = createApp()

app.listen(env.port, () => {
  console.log(`Mayele API disponible sur http://localhost:${env.port}`)
})
