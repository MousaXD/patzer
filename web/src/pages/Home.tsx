import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import * as Icons from 'lucide-react';
import {
  Swords, BookOpen, ChevronRight, Target, Sparkles,
  ListChecks, Award, ArrowRight, GraduationCap, Star, Flame,
} from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { useAuth } from '../state/auth';
import { api } from '../api';
import { fmtAccuracy, fmtTimeControl } from '../lib/utils';
import { goalText } from '../lib/goalText';
import type { GameRow } from '../types';
import { LEARN_QUERY_KEY } from '../components/learn/LessonPlayer';
import { canResumeLesson, fetchLearnProgress, suggestedLesson, useLearnContent } from './Learn';
import { levelOf } from '../learn/engine';
import { localDay } from '../lib/openingTrainer';

// Home — quieter, more hierarchical than the v7.1 design.
// One hero (greeting + stats inline + primary action), one "continue" row of
// at most three compact tiles, one slim recent-games list. No standalone
// stats strip, no "what's new" toast (footer chip handles that), no kitschy
// hero ornaments.

type Achievement = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: 'milestone' | 'mastery' | 'tactics' | 'streaks' | 'learning';
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
  target: number;
};

type PlanGoal = {
  id: number;
  kind: 'puzzles_solve' | 'opening_play' | 'review_games' | 'accuracy' | 'win_streak';
  title: string;
  description: string;
  target: number;
  progress: number;
  status: 'active' | 'completed' | 'expired';
  icon: string;
  created_at: string;
  completes_at: string;
  metadata: Record<string, unknown> | null;
};

interface Stats {
  total: number; wins: number; losses: number; draws: number;
  avg_accuracy: number | null;
  streak: { kind: 'win' | 'loss' | 'draw'; count: number } | null;
}

export default function Home() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const { data: gamesData, isLoading: gamesLoading, isError: gamesError, refetch: refetchGames } = useQuery({
    queryKey: ['games', 'home', user?.id],
    enabled: user?.id != null,
    queryFn: () => api.get<{ games: GameRow[] }>('/api/games?limit=5'),
  });
  const { data: stats, isLoading: statsLoading, isError: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['stats', 'me', user?.id],
    enabled: user?.id != null,
    queryFn: () => api.get<Stats>('/api/stats/me'),
  });
  const { data: planData, isPending: planPending, isError: planError, refetch: refetchPlan } = useQuery({
    queryKey: ['plan-home', user?.id],
    enabled: user?.id != null,
    queryFn: () => api.get<{ goals: PlanGoal[] }>('/api/plan'),
  });
  const { data: achievementsData, isPending: achievementsPending, isError: achievementsError, refetch: refetchAchievements } = useQuery({
    queryKey: ['achievements-home', user?.id],
    enabled: user?.id != null,
    queryFn: () => api.get<{ achievements: Achievement[] }>('/api/achievements'),
  });

  const games = gamesData?.games ?? [];

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <Hero
        displayName={user?.profile.display_name?.trim() || user?.username || t('app.name')}
        avatar={user?.profile.avatar_emoji?.trim() || '♟'}
        stats={stats ?? null}
        loading={statsLoading}
        error={statsError}
        retry={() => void refetchStats()}
        tagline={t('app.tagline')}
      />

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <RecentGames games={games} loading={gamesLoading} error={gamesError} retry={() => void refetchGames()} />
        </div>
        <div className="min-w-0">
          <ContinueRow
            goals={planData?.goals ?? null}
            achievements={achievementsData?.achievements ?? null}
            planLoading={planPending}
            planError={planError}
            retryPlan={() => void refetchPlan()}
            achievementsLoading={achievementsPending}
            achievementsError={achievementsError}
            retryAchievements={() => void refetchAchievements()}
          />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────────  HERO  ────────────────────────────────── */

function Hero({ displayName, avatar, stats, tagline, loading, error, retry }: {
  displayName: string; avatar: string; stats: Stats | null; tagline: string; loading: boolean;
  error: boolean; retry: () => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const hour = new Date().getHours();
  const greetingKey = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  const greeting = t(`home.greet.${greetingKey}`, {
    defaultValue: greetingKey === 'morning' ? 'Good morning'
      : greetingKey === 'afternoon' ? 'Good afternoon' : 'Good evening',
  });

  const hasGames = stats && stats.total > 0;
  const winPct = stats && stats.total ? Math.round((stats.wins / stats.total) * 100) : 0;

  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-chesscom-900 via-[#3b4c2f] to-board-dark text-white shadow-lift"
    >
      {/* Background pattern — a subtle chess-board grid that fades to the
          edges. SVG inline so it ships as a data-URI; no extra request. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.08] [mask-image:radial-gradient(ellipse_at_top_right,black_30%,transparent_75%)]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2' shape-rendering='crispEdges'><rect width='2' height='2' fill='%23ffffff' opacity='0'/><rect x='1' width='1' height='1' fill='%23ffffff'/><rect y='1' width='1' height='1' fill='%23ffffff'/></svg>\")",
          backgroundSize: '56px 56px',
        }}
      />

      {/* At 768px a two-column hero gives the name <60px at 200% text
          scaling. Keep identity above actions until there is actual room. */}
      <div className="relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-[20px] p-[24px] sm:gap-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-[12px] gap-y-1 sm:gap-x-3">
            <div data-home-hero-avatar className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl backdrop-blur sm:row-span-2">
              {avatar}
            </div>
            <div className="min-w-0 break-words text-xs uppercase tracking-[0.08em] text-white/55 sm:tracking-[0.18em]">{greeting}</div>
            <h1 title={displayName} className="col-span-2 line-clamp-2 min-w-0 break-words text-2xl font-bold tracking-tight sm:col-span-1 sm:text-3xl">{displayName}</h1>
          </div>

          {loading ? (
            <div role="status" aria-label={t('home.loadingStats', { defaultValue: 'Loading your statistics' })} className="mt-5 flex flex-wrap gap-3" >
              {[0, 1, 2].map((i) => <span key={i} className="h-6 w-24 animate-pulse rounded bg-white/15" aria-hidden="true" />)}
            </div>
          ) : error ? (
            <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 text-sm text-white/85">
              <span>{t('home.statsUnavailable', { defaultValue: 'Your statistics could not be loaded.' })}</span>
              <button type="button" onClick={retry}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-white/40 px-3 py-1.5 font-semibold text-white transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                {t('common.retry', { defaultValue: 'Retry' })}
              </button>
            </div>
          ) : hasGames ? (
            <div className="mt-5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-white/75">
              <StatInline value={stats!.total.toLocaleString()} label={t('home.statGames', { defaultValue: 'games' })} />
              <StatInline value={`${winPct}%`} label={t('home.statWinRate', { defaultValue: 'win rate' })} />
              {stats!.avg_accuracy != null && (
                <StatInline value={`${stats!.avg_accuracy}%`} label={t('home.statAccuracy', { defaultValue: 'accuracy' })} />
              )}
              {stats!.streak && (
                <StatInline
                  value={`${stats!.streak.count}`}
                  label={t(`home.streak.${stats!.streak.kind}`, { defaultValue: `${stats!.streak.kind} streak` })}
                  glow={stats!.streak.kind === 'win'}
                />
              )}
            </div>
          ) : (
            <p className="mt-[16px] max-w-xl text-sm leading-relaxed text-white/75">{tagline}</p>
          )}
        </div>

        <div className="flex min-w-0 flex-wrap gap-2 lg:flex-col lg:items-end">
          <Link
            to="/play"
            className="group inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-md bg-green-500 px-[14px] py-2.5 text-sm font-bold text-white shadow-soft transition-all hover:bg-green-600 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-chesscom-900 motion-reduce:transition-none lg:px-5"
          >
            <Swords className="h-[18px] w-[18px] shrink-0 lg:h-4 lg:w-4" />
            <span className="min-w-0 break-words">{t('home.playTitle')}</span>
            <ArrowRight className="h-[14px] w-[14px] shrink-0 transition-transform group-hover:translate-x-0.5 lg:h-3.5 lg:w-3.5" />
          </Link>
          <Link
            to="/review"
            className="inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-md bg-white/10 px-[14px] py-2 text-xs font-medium text-white/90 backdrop-blur transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-chesscom-900 motion-reduce:transition-none lg:px-4"
          >
            <BookOpen className="h-[16px] w-[16px] shrink-0 lg:h-3.5 lg:w-3.5" />
            <span className="min-w-0 break-words">{t('home.reviewTitle')}</span>
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

function StatInline({ value, label, glow }: { value: string; label: string; glow?: boolean }) {
  return (
    <span data-home-stat className="inline-flex min-w-0 max-w-full flex-wrap items-baseline gap-x-[6px] gap-y-0 sm:gap-x-1.5">
      <span data-home-stat-value className={`max-w-full break-words font-mono text-xl font-semibold tabular-nums ${glow ? 'text-gold-300' : 'text-white'}`}>
        {value}
      </span>
      <span data-home-stat-label className="min-w-0 max-w-full break-words text-xs uppercase tracking-wider text-white/55">{label}</span>
    </span>
  );
}

/* ───────────────────────  CONTINUE YOUR JOURNEY  ───────────────────────── */

function ContinueRow({ goals, achievements, planLoading, planError, retryPlan, achievementsLoading, achievementsError, retryAchievements }: {
  goals: PlanGoal[] | null;
  achievements: Achievement[] | null;
  planLoading: boolean;
  planError: boolean;
  retryPlan: () => void;
  achievementsLoading: boolean;
  achievementsError: boolean;
  retryAchievements: () => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  // Stagger entrance — modest. 60ms between cards, no scale or rotate gimmicks.
  const variants = {
    hidden: { opacity: 0, y: 8 },
    show: (i: number) => ({ opacity: 1, y: 0, transition: { delay: 0.05 + i * 0.06, duration: 0.3, ease: 'easeOut' as const } }),
  };

  return (
    <section aria-label={t('home.continue', { defaultValue: 'Continue improving' })}>
      <h2 className="mb-2 text-sm font-semibold tracking-tight text-chesscom-900 dark:text-chesscom-100">{t('home.continue', { defaultValue: 'Continue improving' })}</h2>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <motion.div initial={reduceMotion ? false : 'hidden'} animate="show" custom={0} variants={variants}>
          <LearnTile />
        </motion.div>
        <motion.div initial={reduceMotion ? false : 'hidden'} animate="show" custom={1} variants={variants}>
          <DailyPuzzleTile />
        </motion.div>
        <motion.div initial={reduceMotion ? false : 'hidden'} animate="show" custom={2} variants={variants}>
          <PlanTile goals={goals} loading={planLoading} error={planError} retry={retryPlan} />
        </motion.div>
        <motion.div initial={reduceMotion ? false : 'hidden'} animate="show" custom={3} variants={variants}>
          <AchievementsTile achievements={achievements} loading={achievementsLoading} error={achievementsError} retry={retryAchievements} />
        </motion.div>
      </div>
    </section>
  );
}

function LearnTile() {
  const { t } = useTranslation();
  const { t: tl } = useTranslation('learn');
  const { user } = useAuth();
  const { cur } = useLearnContent();
  // The shared learning invalidation prefix still refreshes this query, but
  // cached progress from a previous account is never displayed on Home.
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: [...LEARN_QUERY_KEY, user?.id],
    queryFn: fetchLearnProgress,
    enabled: user?.id != null,
  });
  if ((isPending || isError) && !data) {
    return <ActivityStatusTile label={t('learn.nav')} loading={isPending} retry={() => void refetch()} Icon={GraduationCap} />;
  }
  const progress = new Map((data?.lessons ?? []).map((r) => [r.lesson_id, r]));
  const stars = [...progress.values()].reduce((s, r) => s + r.stars, 0);
  const next = cur ? suggestedLesson(cur, progress) : null;
  const started = next ? canResumeLesson(next, progress.get(next.lesson.id)) : false;
  return (
    <Link to={next ? `/learn?lesson=${next.lesson.id}` : '/learn'} className="card-hover flex h-full items-start gap-[8px] p-[12px] sm:gap-3 sm:p-4">
      <Pill tone="board" Icon={GraduationCap} compact />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[4px]">
          <Kicker>{t('learn.nav')}</Kicker>
          <span className="flex items-center gap-0.5 font-mono text-[11px] tabular-nums text-ui-mutedText">
            {t('learn.levelShort', { n: levelOf(stars).level })} · <Star className="h-3 w-3 fill-gold-500 text-gold-600" />{stars}
          </span>
        </div>
        <Title>{next ? tl(`${next.lesson.id}.title`) : cur ? t('learn.allDone') : t('learn.nav')}</Title>
        <Sub>{next ? (started ? t('home.learnResume') : t('home.learnNext')) : t('home.learnDesc')}</Sub>
      </div>
      <ChevronRight className="h-[16px] w-[16px] shrink-0 text-chesscom-400 sm:h-4 sm:w-4" />
    </Link>
  );
}

interface DailyPuzzle {
  puzzle: { id: string; rating: number } | null;
  done: { solved: boolean } | null;
  streak: number;
}

function ActivityStatusTile({ label, loading, retry, Icon }: {
  label: string; loading: boolean; retry: () => void; Icon: React.ElementType;
}) {
  const { t } = useTranslation();
  return (
    <div role={loading ? 'status' : 'alert'} className="card flex h-full items-start gap-[8px] p-[12px] sm:gap-3 sm:p-4">
      <Pill tone="muted" Icon={Icon} compact />
      <div className="min-w-0 flex-1">
        <Kicker>{label}</Kicker>
        <Title>{loading
          ? t('home.tileLoading', { defaultValue: 'Loading your progress…' })
          : t('home.tileUnavailable', { defaultValue: 'Progress temporarily unavailable' })}</Title>
        {!loading && (
          <button type="button" onClick={retry}
            aria-label={`${t('common.retry', { defaultValue: 'Retry' })} ${label}`}
            className="mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-2 py-1 text-xs font-semibold text-board-dark underline-offset-2 hover:bg-ui-hover hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-board-dark dark:text-gold-400 sm:min-h-11 sm:min-w-11">
            {t('common.retry', { defaultValue: 'Retry' })}
          </button>
        )}
      </div>
    </div>
  );
}

/** The puzzle of the day: one puzzle near your rating, the same all day, and
 *  how many days in a row you've done it (server/src/chess/tactics.ts). */
function DailyPuzzleTile() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Include both the player and local calendar day in the cache identity.
  // Otherwise another account (or tomorrow's session) can see yesterday's
  // solved status and streak until the old cache is evicted.
  const [today, setToday] = useState(localDay);
  useEffect(() => {
    const refreshDay = () => {
      const latest = localDay();
      setToday((previous) => previous === latest ? previous : latest);
    };
    // The page may stay open across midnight or resume from a sleeping tab.
    const interval = window.setInterval(refreshDay, 60_000);
    window.addEventListener('focus', refreshDay);
    const onVisible = () => { if (!document.hidden) refreshDay(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshDay);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['tactics-daily', user?.id, today],
    enabled: user?.id != null,
    queryFn: () => api.get<DailyPuzzle>(`/api/tactics/daily?today=${today}`),
  });
  if ((isPending || isError) && !data) {
    return <ActivityStatusTile label={t('home.todayPuzzle')} loading={isPending} retry={() => void refetch()} Icon={Target} />;
  }
  const done = data?.done ?? null;
  const title = !data ? t('home.todayPuzzle')
    : !data.puzzle ? t('train.puzzles.allDone')
    : done ? (done.solved ? t('home.dailySolved') : t('home.dailyDone'))
    : t('home.dailyOpen');
  return (
    <Link to="/train?tab=puzzles&daily=1" className="card-hover flex h-full items-start gap-[8px] p-[12px] sm:gap-3 sm:p-4">
      <Pill tone={done ? 'board' : 'gold'} Icon={Target} compact />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[4px]">
          <Kicker>{t('home.todayPuzzle')}</Kicker>
          {data?.puzzle && <span className="font-mono text-[11px] tabular-nums text-ui-mutedText">{data.puzzle.rating}</span>}
        </div>
        <Title>{title}</Title>
        <Sub>
          {data && data.streak > 0 ? (
            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-[4px]"><Flame className="h-[14px] w-[14px] shrink-0 text-gold-600 sm:h-3.5 sm:w-3.5" />{t('home.dailyStreak', { count: data.streak })}</span>
          ) : t('home.dailyStart')}
        </Sub>
      </div>
      <ChevronRight className="h-[16px] w-[16px] shrink-0 text-chesscom-400 sm:h-4 sm:w-4" />
    </Link>
  );
}

function PlanTile({ goals, loading, error, retry }: {
  goals: PlanGoal[] | null; loading: boolean; error: boolean; retry: () => void;
}) {
  const { t } = useTranslation();
  if ((loading || error) && !goals) {
    return <ActivityStatusTile label={t('home.planLabel', { defaultValue: "This week's plan" })}
      loading={loading} retry={retry} Icon={ListChecks} />;
  }
  const list = goals ?? [];
  const active = list.filter((g) => g.status === 'active');
  const imminent = active.length
    ? [...active].sort((a, b) => new Date(a.completes_at).getTime() - new Date(b.completes_at).getTime())[0]!
    : null;

  if (active.length === 0) {
    return (
      <Link to="/plan" className="card-hover flex h-full items-start gap-[8px] p-[12px] sm:gap-3 sm:p-4">
        <Pill tone="board" Icon={ListChecks} compact />
        <div className="min-w-0 flex-1">
          <Kicker>{t('home.planLabel', { defaultValue: "This week's plan" })}</Kicker>
          <Title>{t('home.planEmpty', { defaultValue: 'Build your first improvement plan' })}</Title>
          <Sub>{t('home.planEmptyDesc', { defaultValue: 'Pick a few weekly goals — puzzles, openings, accuracy.' })}</Sub>
        </div>
        <ChevronRight className="h-[16px] w-[16px] shrink-0 text-chesscom-400 sm:h-4 sm:w-4" />
      </Link>
    );
  }

  const pct = imminent ? Math.min(100, Math.round((imminent.progress / Math.max(1, imminent.target)) * 100)) : 0;
  return (
    <Link to="/plan" className="card-hover flex h-full items-start gap-[8px] p-[12px] sm:gap-3 sm:p-4">
      <Pill tone="board" Icon={ListChecks} compact />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[4px]">
          <Kicker>{t('home.planLabel', { defaultValue: "This week's plan" })}</Kicker>
            <span className="font-mono text-[11px] tabular-nums text-ui-mutedText">
            {active.length} {t('home.planActive', { defaultValue: 'active' })}
          </span>
        </div>
        {imminent && (
          <>
            <Title>{goalText(t, imminent).title}</Title>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-chesscom-100 dark:bg-chesscom-900">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ delay: 0.4, duration: 0.6, ease: 'easeOut' }}
                  className="h-full bg-board-dark"
                />
              </div>
              <span className="font-mono text-[11px] tabular-nums text-ui-mutedText">
                {imminent.progress}/{imminent.target}
              </span>
            </div>
          </>
        )}
      </div>
      <ChevronRight className="h-[16px] w-[16px] shrink-0 text-chesscom-400 sm:h-4 sm:w-4" />
    </Link>
  );
}

function AchievementsTile({ achievements, loading, error, retry }: {
  achievements: Achievement[] | null; loading: boolean; error: boolean; retry: () => void;
}) {
  const { t } = useTranslation();
  if ((loading || error) && !achievements) {
    return <ActivityStatusTile label={t('home.achievementsLabel', { defaultValue: 'Achievements' })}
      loading={loading} retry={retry} Icon={Award} />;
  }
  const list = achievements ?? [];
  const unlocked = list.filter((a) => a.unlocked);
  const recent = [...unlocked]
    .sort((a, b) => new Date(b.unlocked_at ?? 0).getTime() - new Date(a.unlocked_at ?? 0).getTime())
    .slice(0, 3);

  return (
    <Link to="/insights#achievements" className="card-hover flex h-full items-start gap-[8px] p-[12px] sm:gap-3 sm:p-4">
      <Pill tone="gold" Icon={Award} compact />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-[8px] gap-y-[4px]">
          <Kicker>{t('home.achievementsLabel', { defaultValue: 'Achievements' })}</Kicker>
          <span className="font-mono text-[11px] tabular-nums text-ui-mutedText">
            {unlocked.length}/{list.length || '—'}
          </span>
        </div>
        {recent.length > 0 ? (
          <>
            <Title>{t(`achievements.${recent[0]!.id}.title`, { defaultValue: recent[0]!.title })}</Title>
            <div className="mt-2 flex flex-wrap items-center gap-[6px] sm:gap-1.5">
              {recent.map((a) => {
                const Icon = resolveIcon(a.icon);
                return (
                  <span
                    key={a.id}
                    title={t(`achievements.${a.id}.title`, { defaultValue: a.title })}
                    className="inline-flex h-[28px] w-[28px] items-center justify-center rounded-full bg-gold-500/15 text-gold-600 ring-1 ring-gold-500/30 sm:h-7 sm:w-7"
                  >
                    <Icon className="h-[14px] w-[14px] sm:h-3.5 sm:w-3.5" />
                  </span>
                );
              })}
              {unlocked.length > 3 && (
                <span className="text-[11px] text-ui-mutedText">+{unlocked.length - 3}</span>
              )}
            </div>
          </>
        ) : (
          <>
            <Title>{t('home.achievementsEmpty', { defaultValue: 'Earn your first badge' })}</Title>
            <Sub>{t('home.achievementsEmptyDesc', { defaultValue: 'Play and analyze a game to unlock.', n: list.length })}</Sub>
          </>
        )}
      </div>
      <ChevronRight className="h-[16px] w-[16px] shrink-0 text-chesscom-400 sm:h-4 sm:w-4" />
    </Link>
  );
}

/* ─────────────────────────────  RECENT GAMES  ──────────────────────────── */

function RecentGames({ games, loading, error, retry }: { games: GameRow[]; loading: boolean; error: boolean; retry: () => void }) {
  const { t, i18n } = useTranslation();
  const reduceMotion = useReducedMotion();
  if (loading) return (
    <section className="card p-5" role="status" aria-live="polite">
      <p className="text-sm text-ui-mutedText">{t('home.loadingGames', { defaultValue: 'Loading recent games…' })}</p>
      <div className="mt-4 space-y-2" aria-hidden="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-chesscom-100 dark:bg-chesscom-700" />)}
      </div>
    </section>
  );
  if (error) return (
    <section className="card flex flex-wrap items-center justify-between gap-3 p-5" role="alert">
      <p className="text-sm text-chesscom-600 dark:text-chesscom-300">{t('home.gamesUnavailable', { defaultValue: 'Recent games could not be loaded.' })}</p>
      <button type="button" onClick={retry} className="btn-secondary min-h-11 min-w-11 text-sm">{t('common.retry', { defaultValue: 'Retry' })}</button>
    </section>
  );
  if (games.length === 0) {
    return (
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25, duration: 0.3 }}
        className="card overflow-hidden"
        aria-labelledby="home-first-game-heading"
        data-home-onboarding
      >
        <div className="p-[20px] sm:p-6">
          <div className="flex items-start gap-[12px] sm:gap-3">
            <Pill tone="board" Icon={Sparkles} compact />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-mutedText">
                {t('home.gettingStarted', { defaultValue: 'Your starting point' })}
              </p>
              <h2 id="home-first-game-heading" className="mt-1 text-lg font-bold tracking-tight text-ui-foreground">
                {t('home.firstRunTitle', { defaultValue: 'Play your first game' })}
              </h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-ui-mutedText">
                {t('home.firstRunReady', { defaultValue: 'Play a game here or import one to review.' })}
              </p>
            </div>
          </div>
          <div className="mt-[20px] grid gap-[12px] sm:mt-5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-1 xl:grid-cols-2">
            {[
              { to: '/play', icon: Swords, title: t('home.playTitle'), description: t('home.playDesc') },
              { to: '/review', icon: BookOpen, title: t('home.importGames'), description: t('home.reviewDesc') },
            ].map(({ to, icon: Icon, title, description }) => (
              <Link key={to} to={to} data-home-onboarding-action
                className="group flex min-w-0 items-start gap-[8px] rounded-xl border border-ui-border bg-ui-muted p-[12px] transition-colors hover:border-ui-strong hover:bg-ui-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus sm:gap-3 sm:p-3.5"
              >
                <Icon aria-hidden="true" className="mt-0.5 h-[20px] w-[20px] shrink-0 text-ui-primary sm:h-5 sm:w-5" />
                <span className="min-w-0 flex-1">
                  <span data-home-onboarding-action-title className="block min-w-0 break-words text-sm font-semibold text-ui-foreground">{title}</span>
                  <span className="mt-1 block min-w-0 break-words text-xs leading-relaxed text-ui-mutedText">{description}</span>
                </span>
                <ChevronRight aria-hidden="true" className="mt-1 h-[16px] w-[16px] shrink-0 text-ui-mutedText transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none sm:h-4 sm:w-4" />
              </Link>
            ))}
          </div>
        </div>
        <p className="border-t border-ui-border bg-ui-muted px-[20px] py-[12px] text-xs text-ui-mutedText sm:px-6 sm:py-3">
          {t('home.firstRunFooter', { defaultValue: 'Your recent games will appear here after you play or import one.' })}
        </p>
      </motion.section>
    );
  }
  return (
    <motion.section
      initial={reduceMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18, duration: 0.3 }}
    >
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight text-chesscom-900 dark:text-chesscom-100">
          {t('home.recentGames', { defaultValue: 'Recent games' })}
        </h2>
        <Link to="/review" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-xs font-semibold text-board-dark hover:bg-ui-hover hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ui-focus dark:text-gold-400">
          {t('home.viewAll', { defaultValue: 'View all →' })}
        </Link>
      </div>
      <ul className="divide-y divide-chesscom-100 overflow-hidden rounded-xl border border-chesscom-200 bg-white shadow-soft dark:divide-chesscom-800 dark:border-chesscom-700 dark:bg-chesscom-800">
        {games.map((g) => (
          <li key={g.id}>
            <Link
              to={`/review/${g.id}`}
              className="flex items-start gap-[12px] px-[12px] py-[10px] transition-colors hover:bg-chesscom-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ui-focus dark:hover:bg-chesscom-900/40 sm:items-center sm:gap-3 sm:px-4 sm:py-3"
            >
              <ResultGlyph r={g.result} />
              <div className="min-w-0 flex-1">
                <div className="min-w-0 text-sm font-medium">
                  {/* The account name is repeated on every Home row. Leading
                      with it on 320px phones hides the one detail that lets
                      people distinguish their games: the opponent. */}
                  <div data-home-recent-name className="flex min-w-0 flex-wrap items-start gap-x-[4px] sm:hidden">
                    <span className="shrink-0 text-ui-mutedText">{t('players.vs')}</span>
                    <span data-home-recent-opponent className="line-clamp-2 min-w-[120px] flex-1 break-words font-semibold text-ui-foreground">
                      {g.user_color === 'white' ? g.black : g.white}
                    </span>
                  </div>
                  <div data-home-recent-desktop-matchup className="hidden min-w-0 items-center gap-1.5 sm:flex">
                    <span
                      data-home-recent-desktop-opponent={g.user_color === 'black' ? '' : undefined}
                      title={g.white}
                      className={g.user_color === 'white'
                        ? 'max-w-[40%] shrink-0 truncate text-chesscom-900 dark:text-chesscom-100'
                        : 'min-w-0 flex-1 truncate text-ui-mutedText'}
                    >
                      {g.white}
                    </span>
                    <span className="shrink-0 text-chesscom-400">{t('players.vs')}</span>
                    <span
                      data-home-recent-desktop-opponent={g.user_color === 'white' ? '' : undefined}
                      title={g.black}
                      className={g.user_color === 'black'
                        ? 'max-w-[40%] shrink-0 truncate text-chesscom-900 dark:text-chesscom-100'
                        : 'min-w-0 flex-1 truncate text-ui-mutedText'}
                    >
                      {g.black}
                    </span>
                  </div>
                </div>
                <div data-home-recent-metadata className="mt-[4px] flex min-w-0 flex-wrap items-baseline gap-x-[8px] gap-y-[2px] text-xs text-ui-mutedText sm:mt-0 sm:block">
                  <span data-home-recent-date className="max-w-full break-words">{g.end_time ? new Date(g.end_time).toLocaleDateString(i18n.language) : t('review.inProgress', { defaultValue: 'In progress' })}</span>
                  <span className="mx-1.5 hidden text-chesscom-400 sm:inline">·</span>
                  <span data-home-recent-time-control className="max-w-full break-words">{fmtTimeControl(g.time_control, t)}</span>
                  {!g.analyzed && (
                    <span data-home-recent-unreviewed className="min-w-0 max-w-full break-words sm:hidden">
                      {t('home.unreviewed', { defaultValue: 'unreviewed' })}
                    </span>
                  )}
                  {g.opening_name && (
                    <span className="hidden sm:inline">
                      <span className="mx-1.5 text-chesscom-400">·</span>
                      <span className="truncate">{g.opening_name}</span>
                    </span>
                  )}
                </div>
                {g.analyzed && (
                  <div data-home-mobile-accuracy className="mt-[4px] flex min-w-0 flex-wrap gap-x-[8px] gap-y-[2px] text-xs text-ui-mutedText sm:hidden">
                    <span className="min-w-0 max-w-full break-words">
                      {t('players.you', { defaultValue: 'You' })}: {' '}
                      <span data-home-accuracy-self className="font-mono font-semibold text-ui-foreground">
                        {fmtAccuracy(g.user_color === 'white' ? g.accuracy_white : g.accuracy_black)}
                      </span>
                    </span>
                    <span className="min-w-0 max-w-full break-words">
                      {t('home.opponent', { defaultValue: 'Opponent' })}: {' '}
                      <span data-home-accuracy-opponent className="font-mono text-ui-mutedText">
                        {fmtAccuracy(g.user_color === 'white' ? g.accuracy_black : g.accuracy_white)}
                      </span>
                    </span>
                  </div>
                )}
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                {g.analyzed ? (
                  <div className="font-mono text-xs tabular-nums">
                    <span className={g.user_color === 'white' ? 'font-semibold text-chesscom-900 dark:text-chesscom-100' : 'text-ui-mutedText'}>
                      {fmtAccuracy(g.accuracy_white)}
                    </span>
                    <span className="mx-1 text-ui-mutedText">/</span>
                    <span className={g.user_color === 'black' ? 'font-semibold text-chesscom-900 dark:text-chesscom-100' : 'text-ui-mutedText'}>
                      {fmtAccuracy(g.accuracy_black)}
                    </span>
                  </div>
                ) : (
                  <span className="hidden text-[11px] uppercase tracking-wider text-ui-mutedText sm:inline">
                    {t('home.unreviewed', { defaultValue: 'unreviewed' })}
                  </span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

/* ─────────────────────────────────  ATOMS  ─────────────────────────────── */

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ui-mutedText">{children}</div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return (
    <div data-home-continue-title className="mt-0.5 min-w-0 break-words text-sm font-semibold text-chesscom-900 dark:text-chesscom-100 sm:line-clamp-2">{children}</div>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return (
    <div data-home-continue-description className="mt-1 min-w-0 break-words text-xs text-ui-mutedText sm:line-clamp-2">{children}</div>
  );
}

function Pill({ Icon, tone, compact = false }: {
  Icon: React.ElementType; tone: 'gold' | 'board' | 'mistake' | 'muted'; compact?: boolean;
}) {
  const toneCls: Record<typeof tone, string> = {
    gold: 'bg-gold-500/15 text-gold-600',
    board: 'bg-board-dark/15 text-board-dark',
    mistake: 'bg-[color:var(--tw-bg)] text-[color:var(--tw-fg)]', // fallback if used
    muted: 'bg-chesscom-100 text-chesscom-500 dark:bg-chesscom-700 dark:text-chesscom-300',
  };
  // For 'mistake' tone use direct tailwind classes since we have move.mistake palette
  const cls = tone === 'mistake'
    ? 'bg-[#ffa459]/15 text-[#ffa459]'
    : toneCls[tone];
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-[44px] w-[44px] sm:h-10 sm:w-10' : 'h-10 w-10'} ${cls}`}>
      <Icon className={compact ? 'h-[18px] w-[18px] sm:h-4 sm:w-4' : 'h-4 w-4'} />
    </div>
  );
}

function ResultGlyph({ r }: { r: string }) {
  const { t } = useTranslation();
  if (r === 'win') {
    const label = t('home.outcome.win', { defaultValue: 'Win' });
    return (
      <span role="img" aria-label={label} title={label}
        className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md bg-green-500/15 text-[12px] font-bold text-ui-success sm:h-7 sm:w-7 sm:text-xs">
        W
      </span>
    );
  }
  if (r === 'loss') {
    const label = t('home.outcome.loss', { defaultValue: 'Loss' });
    return (
      <span role="img" aria-label={label} title={label}
        className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md bg-bad/15 text-[12px] font-bold text-ui-danger sm:h-7 sm:w-7 sm:text-xs">
        L
      </span>
    );
  }
  if (r !== 'draw') {
    const label = t('review.inProgress', { defaultValue: 'In progress' });
    return (
      <span role="img" aria-label={label} title={label}
        className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md bg-chesscom-100 text-[12px] text-chesscom-500 dark:bg-chesscom-700 dark:text-ui-mutedText sm:h-7 sm:w-7 sm:text-xs">
        •
      </span>
    );
  }
  const label = t('home.outcome.draw', { defaultValue: 'Draw' });
  return (
    <span role="img" aria-label={label} title={label}
      className="inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-md bg-chesscom-100 text-[12px] font-bold text-chesscom-500 dark:bg-chesscom-700 dark:text-ui-mutedText sm:h-7 sm:w-7 sm:text-xs">
      D
    </span>
  );
}

function resolveIcon(name: string): React.ComponentType<{ className?: string }> {
  const lib = Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>;
  return lib[name] ?? lib.Award ?? (() => null);
}
