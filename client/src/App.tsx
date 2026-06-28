import { useState } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './context/auth'
import { DashboardPage } from './pages/DashboardPage'
import { GamePage } from './pages/GamePage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'

function App() {
  const { user, isAuthenticated, loading, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  function handleLogout() {
    void logout().finally(() => setMobileMenuOpen(false))
  }

  const authLinks = isAuthenticated ? (
    <>
      <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} to="/dashboard">
        Mon espace
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
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to={isAuthenticated ? '/dashboard' : '/'}>
          Mayele <span>Maths</span>
        </NavLink>

        <nav className="nav-links">
          {!isAuthenticated ? (
            <NavLink className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} end to="/">
              Accueil
            </NavLink>
          ) : null}
          {authLinks}
        </nav>

        <div className="topbar-actions">
          {isAuthenticated ? (
            <>
              <span className="welcome-chip">Bonjour {user?.name}</span>
              <button className="ghost-button" type="button" onClick={handleLogout}>
                Déconnexion
              </button>
            </>
          ) : (
            <NavLink className="primary-button" to="/inscription">
              Commencer
            </NavLink>
          )}
        </div>

        <button
          className="mobile-menu-button"
          type="button"
          aria-controls="mobile-menu-panel"
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          onClick={() => setMobileMenuOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      {mobileMenuOpen ? (
        <div className="mobile-menu-overlay" role="presentation" onClick={() => setMobileMenuOpen(false)}>
          <nav
            id="mobile-menu-panel"
            className="mobile-menu-panel"
            aria-label="Navigation mobile"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobile-menu-heading">
              <span>Menu</span>
              {isAuthenticated ? <strong>{user?.name}</strong> : null}
            </div>
            {isAuthenticated ? (
              <>
                <NavLink
                  className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
                  to="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Mon espace
                </NavLink>
                <NavLink
                  className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
                  to="/jeu"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Jouer
                </NavLink>
                <button className="mobile-nav-link danger" type="button" onClick={handleLogout}>
                  Déconnexion
                </button>
              </>
            ) : (
              <>
                <NavLink
                  className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
                  end
                  to="/"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Accueil
                </NavLink>
                <NavLink
                  className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
                  to="/connexion"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Connexion
                </NavLink>
                <NavLink
                  className={({ isActive }) => (isActive ? 'mobile-nav-link active' : 'mobile-nav-link')}
                  to="/inscription"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  Inscription
                </NavLink>
              </>
            )}
          </nav>
        </div>
      ) : null}

      <main className="main-content">
        <Routes>
          <Route
            path="/"
            element={
              loading ? (
                <section className="page narrow-page">
                  <div className="card loading-card">Chargement...</div>
                </section>
              ) : isAuthenticated ? (
                <Navigate replace to="/dashboard" />
              ) : (
                <HomePage />
              )
            }
          />
          <Route path="/connexion/*" element={<LoginPage />} />
          <Route path="/inscription/*" element={<RegisterPage />} />
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
          <Route path="*" element={<Navigate replace to={isAuthenticated ? '/dashboard' : '/'} />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
