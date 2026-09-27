import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { NameGate } from './components/NameGate';
import { AdminContestPage } from './pages/AdminContestPage';
import { AdminLivePage } from './pages/AdminLivePage';
import { AdminPage } from './pages/AdminPage';
import { ContestPage } from './pages/ContestPage';
import { HomePage } from './pages/HomePage';
import { useSession } from './state/SessionContext';

export function App() {
  const { identity, saveName, isAdmin } = useSession();
  const location = useLocation();
  const inAdmin = location.pathname.startsWith('/admin');

  return (
    <div className="app">
      <header className="appbar">
        <Link to="/" className="appbar__title" style={{ color: 'inherit' }}>
          <span className="appbar__logo">FC</span>
          Fantasy Contests
        </Link>
        <span className="appbar__spacer" />
        {identity ? <span className="tiny muted">{identity.displayName}</span> : null}
        <Link
          to={inAdmin ? '/' : '/admin'}
          className="btn btn--sm btn--ghost"
          aria-label={inAdmin ? 'Exit admin' : 'Admin area'}
        >
          {inAdmin ? 'Exit admin' : isAdmin ? 'Admin ✓' : 'Admin'}
        </Link>
      </header>

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/contest/:contestId" element={<ContestPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/admin/new" element={<AdminContestPage />} />
        <Route path="/admin/contest/:contestId" element={<AdminContestPage />} />
        <Route path="/admin/live/:contestId" element={<AdminLivePage />} />
        <Route
          path="*"
          element={
            <div className="page">
              <div className="empty">
                Page not found. <Link to="/">Back to contests</Link>
              </div>
            </div>
          }
        />
      </Routes>

      {/* Name is required to play, but the admin area does not need one. */}
      {!identity && !inAdmin ? <NameGate onSave={saveName} /> : null}
    </div>
  );
}
