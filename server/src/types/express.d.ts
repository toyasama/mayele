import type { AuthContext } from '../middleware/auth.js'

declare global {
  namespace Express {
    interface Request {
      authContext?: AuthContext
    }
  }
}
