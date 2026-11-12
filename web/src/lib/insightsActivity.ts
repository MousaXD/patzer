/** Server activity dates come from UTC YYYY-MM-DD game timestamps. */
export interface DailyActivity {
  day: string;
  games: number;
  wins: number;
}

export interface ActivityCell {
  date: string;
  day: number;
  games: number;
  wins: number;
  inRange: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Align calendar columns Sunday–Saturday, exactly like a year heatmap.
 * The API reports the last 365 UTC days; other dates in the 53-week visual
 * envelope are placeholders, NOT days with zero games.
 */
export function buildActivityGrid(data: DailyActivity[], now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const firstSunday = today - (52 * 7 + new Date(today).getUTCDay()) * DAY_MS;
  const oldestReported = today - 364 * DAY_MS;
  const byDay = new Map(data.map((row) => [row.day, row]));
  const cells: ActivityCell[] = [];
  let max = 0;

  for (let i = 0; i < 53 * 7; i++) {
    const ms = firstSunday + i * DAY_MS;
    const date = new Date(ms).toISOString().slice(0, 10);
    const inRange = ms >= oldestReported && ms <= today;
    const entry = inRange ? byDay.get(date) : undefined;
    const games = entry?.games ?? 0;
    const wins = entry?.wins ?? 0;
    max = Math.max(max, games);
    cells.push({ date, day: new Date(ms).getUTCDay(), games, wins, inRange });
  }
  return { cells, max };
}
