import type { MouseEvent } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import AnalysisPage from './pages/AnalysisPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import AccountPage from './pages/AccountPage';
import OrgPage from './pages/OrgPage';
import TeachPage from './pages/TeachPage';
import StudentPage from './pages/StudentPage';
import { UnsavedChangesProvider, useConfirmDiscard } from './unsavedChanges';
import { ThemeProvider, ThemeSwitcher } from './theme';
import { RequireAuth, SessionProvider, useSession } from './session';
import { displayName } from './accounts';
import { TourProvider, useTour } from './tour/Tour';

/**
 * The header's account links, by role: an Organization link for every org the
 * reader administers, a Teaching link for every one they teach in. Both name
 * the org when there is more than one, because the link's destination is a
 * particular org and nothing else on the page says which.
 */
function AccountLinks({ guard }: { guard: (event: MouseEvent) => void }) {
  const { user, loading, logout } = useSession();
  if (loading) return null;
  if (user === null) {
    return (
      <Link to="/login" className="app-account">
        Sign in
      </Link>
    );
  }
  const admin = user.memberships.filter((m) => m.role === 'admin');
  const teaching = user.memberships.filter((m) => m.role === 'professor');
  const name = (label: string, count: number, org: string) =>
    count > 1 ? `${label}: ${org}` : label;
  return (
    <>
      <Link to="/account" className="app-account" onClick={guard}>
        {displayName(user)}
      </Link>
      {admin.map((m) => (
        <Link
          key={`org-${m.org.id}`}
          to={`/org/${m.org.id}`}
          className="app-account"
          onClick={guard}
        >
          {name('Organization', admin.length, m.org.name)}
        </Link>
      ))}
      {teaching.map((m) => (
        <Link
          key={`teach-${m.org.id}`}
          to={`/teach/${m.org.id}`}
          className="app-account"
          onClick={guard}
        >
          {name('Teaching', teaching.length, m.org.name)}
        </Link>
      ))}
      <TourLink guard={guard} />
      <button
        type="button"
        className="link-button app-signout"
        onClick={(event) => {
          if (!guardAllows(guard, event)) return;
          void logout();
        }}
      >
        Sign out
      </button>
    </>
  );
}

/**
 * The header's "Take tour". The tour opens on the home page, so from there it
 * starts at the beginning; on an analysis it starts at the editor's own steps
 * rather than sending the reader away from their work; anywhere else it goes
 * home first (through the unsaved-changes guard, like every header link).
 */
function TourLink({ guard }: { guard: (event: MouseEvent) => void }) {
  const tour = useTour();
  const location = useLocation();
  const navigate = useNavigate();
  if (!tour.available) return null;
  return (
    <button
      type="button"
      className="link-button app-account"
      onClick={(event) => {
        if (location.pathname === '/') {
          tour.start();
        } else if (location.pathname.startsWith('/analysis/')) {
          tour.start('text');
        } else {
          if (!guardAllows(guard, event)) return;
          navigate('/');
          tour.start();
        }
      }}
    >
      Take tour
    </button>
  );
}

/** Run the unsaved-changes guard against a click, and say whether it passed. */
function guardAllows(guard: (event: MouseEvent) => void, event: MouseEvent): boolean {
  guard(event);
  return !event.defaultPrevented;
}

function Header() {
  const confirmDiscard = useConfirmDiscard();
  const guard = (event: MouseEvent) => {
    if (!confirmDiscard()) event.preventDefault();
  };
  return (
    <header className="app-header">
      <Link to="/" className="app-brand" onClick={guard}>
        datool
      </Link>
      <span className="muted app-tagline">discourse analysis</span>
      <ThemeSwitcher />
      <Link to="/?new=1" className="app-add" onClick={guard}>
        New analysis
      </Link>
      <AccountLinks guard={guard} />
    </header>
  );
}

export default function App() {
  // The session comes first: the skin is a signed-in reader's choice, so the
  // ThemeProvider has to know whether anyone is.
  return (
    <SessionProvider>
      <ThemeProvider>
        <UnsavedChangesProvider>
          <TourProvider>
          <div className="app">
            <Header />
            <main className="app-main">
              <Routes>
                {/* Public: the way in. */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password/:uid/:token" element={<ResetPasswordPage />} />
                {/* Everything else is somebody's own work. */}
                <Route
                  path="/"
                  element={
                    <RequireAuth>
                      <HomePage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/analysis/:id"
                  element={
                    <RequireAuth>
                      <AnalysisPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/account"
                  element={
                    <RequireAuth>
                      <AccountPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/org/:id"
                  element={
                    <RequireAuth>
                      <OrgPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/teach/:id"
                  element={
                    <RequireAuth>
                      <TeachPage />
                    </RequireAuth>
                  }
                />
                <Route
                  path="/students/:mid"
                  element={
                    <RequireAuth>
                      <StudentPage />
                    </RequireAuth>
                  }
                />
              </Routes>
            </main>
          </div>
          </TourProvider>
        </UnsavedChangesProvider>
      </ThemeProvider>
    </SessionProvider>
  );
}
