process.env.NODE_ENV = 'production'

const { assertProductionEnv } = await import('../src/config/env.js')

assertProductionEnv()
console.log('Configuration de production serveur valide.')
