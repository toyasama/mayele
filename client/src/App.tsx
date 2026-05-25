import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './context/AuthContext'
import { DashboardPage } from './pages/DashboardPage'
import { GamePage } from './pages/GamePage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'

function App() {
  const { user, isAuthenticated, logout } = useAuth()

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/">
          Mayele <span>Maths</span>
        </NavLink>

        <nav className="nav-links">
          <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} end to="/">
            Accueil
          </NavLink>
          {isAuthenticated ? (
            <>
              <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} to="/dashboard">
                Dashboard
              </NavLink>
              <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} to="/jeu">
                Jouer
              </NavLink>
            </>
          ) : (
            <>
              <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} to="/connexion">
                Connexion
              </NavLink>
              <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} to="/inscription">
                Inscription
              </NavLink>
            </>
          )}
        </nav>

        <div className="topbar-actions">
          {isAuthenticated ? (
            <>
              <span className="welcome-chip">Bonjour {user?.name}</span>
              <button className="ghost-button" type="button" onClick={logout}>
                Déconnexion
              </button>
            </>
          ) : (
            <NavLink className="primary-button" to="/inscription">
              Commencer
            </NavLink>
          )}
        </div>
      </header>

      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/connexion" element={<LoginPage />} />
          <Route path="/inscription" element={<RegisterPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/jeu"
            element={
              <ProtectedRoute>
                <GamePage />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate replace to="/" />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
