import { lazy, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from './state/auth';
import { useLobby } from './state/lobby';
import { setMoveSoundSet, setSoundEnabled, setSoundSet, unlockAudio } from './lib/sounds';
import Layout from './components/Layout';
import Setup from './pages/Setup';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import IncomingChallengeModal from './components/IncomingChallengeModal';
import CommandPalette from './components/CommandPalette';
import ShortcutsModal from './components/ShortcutsModal';
import { LogoMark } from './components/Logo';

// Route-level splitting keeps Stockfish review, PvP, charts and admin pages out
// of the initial login/dashboard bundle. Layout remains mounted during loads.
const Home = lazy(() => import('./pages/Home'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Play = lazy(() => import('./pages/Play'));
const Review = lazy(() => import('./pages/Review'));
const GameAnalyzer = lazy(() => import('./pages/GameAnalyzer'));
const Insights = lazy(() => import('./pages/Insights'));
const Train = lazy(() => import('./pages/Train'));
const Openings = lazy(() => import('./pages/Openings'));
const Learn = lazy(() => import('./pages/Learn'));
const Plan = lazy(() => import('./pages/Plan'));
const Lab = lazy(() => import('./pages/Lab'));
const Players = lazy(() => import('./pages/Players'));
const PlayerProfile = lazy(() => import('./pages/PlayerProfile'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminSystem = lazy(() => import('./pages/admin/System'));
const McpConnection = lazy(() => import('./pages/admin/McpConnection'));

export default function App() {
  const { loading, setupRequired, user, refresh } = useAuth();
  const { i18n } = useTranslation();
  const location = useLocation();
  const nav = useNavigate();
  const lobby = useLobby();

  useEffect(() => { void refresh(); }, [refresh]);

  // Connect/disconnect lobby WS based on auth + apply sound setting
  useEffect(() => {
    if (user) {
      lobby.connect();
      setSoundEnabled(!!user.profile.sound_enabled);
      setSoundSet(user.profile.sound_set);
      setMoveSoundSet(user.profile.move_sound_set);
    } else {
      lobby.disconnect();
    }
    return () => { /* keep connection during navigation; disconnect on logout */ };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.profile.sound_enabled, user?.profile.sound_set, user?.profile.move_sound_set]);

  // Unlock Web Audio on first user interaction (browser policy)
  useEffect(() => {
    const onInteract = () => { unlockAudio(); window.removeEventListener('click', onInteract); window.removeEventListener('keydown', onInteract); };
    window.addEventListener('click', onInteract);
    window.addEventListener('keydown', onInteract);
    return () => { window.removeEventListener('click', onInteract); window.removeEventListener('keydown', onInteract); };
  }, []);

  // When the challenger gets "challenge_accepted" via lobby WS, navigate to game
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      const nav$ = lobby.consumeAcceptedNav();
      if (nav$) nav(`/play?game=${nav$.game_id}`);
    }, 500);
    return () => clearInterval(id);
  }, [user, lobby, nav]);

  // Sync UI language with profile language whenever the user changes
  useEffect(() => {
    if (user?.profile?.language && user.profile.language !== i18n.language) {
      void i18n.changeLanguage(user.profile.language);
    }
  }, [user, i18n]);

  // Global keyboard shortcuts (only when authenticated). ⌘K / Ctrl+K opens
  // the command palette, ? opens the shortcuts overlay, "g X" jumps pages.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const gPrefixRef = useRef<number>(0);
  useEffect(() => {
    if (!user) return;
    function isTextField(t: EventTarget | null): boolean {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      // ⌘K / Ctrl+K — palette (always, even in inputs).
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isTextField(e.target)) return;
      if (e.key === '?') { e.preventDefault(); e.stopImmediatePropagation(); setShortcutsOpen(true); return; }
      // "g X" prefix navigation
      if (e.key === 'g' || e.key === 'G') {
        gPrefixRef.current = Date.now();
        return;
      }
      const since = Date.now() - gPrefixRef.current;
      if (since < 1200) {
        const map: Record<string, string> = { h: '/', p: '/play', r: '/review', i: '/insights', t: '/train', e: '/learn', s: '/settings', o: '/openings', n: '/plan', l: '/lab', u: '/players' };
        const target = map[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          e.stopImmediatePropagation();
          gPrefixRef.current = 0;
          nav(target);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [user, nav]);

  // Reconcile the saved profile with the pre-paint bootstrap. The explicit
  // legacy "auto" setting continues to follow OS changes.
  useEffect(() => {
    if (loading) return;
    const saved = user?.profile?.site_theme;
    const choice = saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'light';
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'auto' && query.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
      document.documentElement.style.backgroundColor = dark ? '#171a1c' : '#ffffff';
      document.querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#171a1c' : '#ffffff');
    };
    try {
      if (user) window.localStorage.setItem('patzer-site-theme', choice);
      else window.localStorage.removeItem('patzer-site-theme');
    } catch { /* storage may be unavailable */ }
    apply();
    if (choice === 'auto') {
      query.addEventListener('change', apply);
      return () => query.removeEventListener('change', apply);
    }
    return undefined;
  }, [loading, user?.id, user?.profile?.site_theme]);

  if (loading) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 text-ink-500">
        <div className="animate-pulse-soft">
          <LogoMark size={56} />
        </div>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-ink-200 dark:bg-ink-800">
          <div className="h-full w-1/3 animate-loader-slide bg-amber-500" />
        </div>
      </div>
    );
  }

  if (setupRequired) {
    if (location.pathname !== '/setup') return <Navigate to="/setup" replace />;
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        {/* Reached from emailed links — must work without an authenticated session. */}
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <>
      <Routes>
        {/* Email links still resolve even if the user happens to be logged in. */}
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route element={<Layout onOpenPalette={() => setPaletteOpen(true)} onOpenShortcuts={() => setShortcutsOpen(true)} />}>
          <Route path="/" element={<Home />} />
          <Route path="/play" element={<Play />} />
          <Route path="/review" element={<Review />} />
          <Route path="/review/:id" element={<GameAnalyzer />} />
          <Route path="/insights" element={<Insights />} />
          <Route path="/train" element={<Train />} />
          <Route path="/learn" element={<Learn />} />
          <Route path="/openings" element={<Openings />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/lab" element={<Lab />} />
          <Route path="/players" element={<Players />} />
          <Route path="/players/:id" element={<PlayerProfile />} />
          <Route path="/settings" element={<SettingsPage />} />
          {user.role === 'admin' && <Route path="/admin/users" element={<AdminUsers />} />}
          {user.role === 'admin' && <Route path="/admin/system" element={<AdminSystem />} />}
          {user.role === 'admin' && <Route path="/admin/mcp" element={<McpConnection />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <IncomingChallengeModal />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
