import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { NameGate } from './components/NameGate';
import { AdminPage } from './pages/AdminPage';
import { ContestBuilderPage } from './pages/ContestBuilderPage';
import { ContestLivePage } from './pages/ContestLivePage';
import { ContestPage } from './pages/ContestPage';
import { HomePage } from './pages/HomePage';
import { useSession } from './state/SessionContext';

export function App() {
  const { identity, saveName, isAdmin, ready } = useSession();
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

      {/* Who is playing decides what every page below reads and writes, so the
          app waits on it rather than loading one person's contests and then
          another's. The admin area belongs to nobody in particular. */}
      {!ready && !inAdmin ? (
        <div className="page">
          <div className="empty">Loading…</div>
        </div>
      ) : (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/new" element={<ContestBuilderPage />} />
        <Route path="/contest/:contestId" element={<ContestPage />} />
        <Route path="/contest/:contestId/edit" element={<ContestBuilderPage />} />
        <Route path="/contest/:contestId/live" element={<ContestLivePage />} />
        <Route path="/admin" element={<AdminPage />} />
        {/* Where contest management used to live. */}
        <Route path="/admin/new" element={<Navigate to="/new" replace />} />
        <Route path="/admin/contest/:contestId" element={<ContestRedirect suffix="edit" />} />
        <Route path="/admin/live/:contestId" element={<ContestRedirect suffix="live" />} />
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
      )}

      {/* Name is required to play, but the settings area does not need one. */}
      {!identity && !inAdmin ? <NameGate onSave={saveName} /> : null}
    </div>
  );
}

function ContestRedirect({ suffix }: { suffix: string }) {
  const { contestId } = useParams<{ contestId: string }>();
  return <Navigate to={contestId ? `/contest/${contestId}/${suffix}` : '/'} replace />;
}
