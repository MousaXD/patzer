# Patzer frontend design system (Agent 01)

## Integration and ownership

Owns `web/src/index.css`, `web/tailwind.config.js`, `web/index.html`, theme initialization only in `web/src/App.tsx`, `web/public/theme-init.js`, local fonts, `web/src/components/ui/`, the new design-system tests and CI workflow. No changes to Layout, GameAnalyzer, ChessBoard, Settings, existing backend, or existing test assertions. Do not merge this PR directly.

**Default:** white/light for anonymous and pre-auth visitors, regardless of device appearance. `theme-init.js` executes synchronously in `<head>` before application initialization and restores last known authenticated site-theme preference from localStorage. React then reconciles it to the real signed-in user profile. Existing explicit `light`, `dark` and legacy `auto` preferences are preserved. `auto` follows the OS dynamically. Logout clears the cached profile preference.

### Required Agent 00 backend handoff — new accounts

The current `server/src/db.ts` column default is `site_theme TEXT NOT NULL DEFAULT 'auto'`; `server/src/routes/auth.ts`, `server/src/routes/setup.ts`, and `server/src/auth/oidc.ts` create profiles without specifying `site_theme`. **An unchanged frontend cannot tell an existing user who chose Auto from a newly created user who inherited Auto.** To make the user-facing *new account* default Light while preserving all saved legacy Auto values, Agent 00 must set `site_theme='light'` for every newly inserted profile (signup, initial setup, OIDC). Also change the new-database `CREATE TABLE profiles` default to `light` if appropriate. Do not rewrite existing rows with `auto`, change the API shape, remove Auto from the enum, or apply a blanket migration. The legacy `ensureColumn(... DEFAULT 'auto')` can remain as-is for historic databases. Until Agent 00 integrates this, newly created authenticated profiles with the backend's Auto value may become dark on OS-dark systems.

### CSS / Tailwind contract for Agents 02, 03 and 05

| Purpose | CSS custom property | Tailwind utility |
| --- | --- | --- |
| Page | `--ui-bg` | `bg-ui-bg` |
| Base panel | `--ui-surface` | `bg-ui-surface` |
| Raised panel | `--ui-surface-raised` | `bg-ui-raised` |
| Subtle panel | `--ui-surface-muted` | `bg-ui-muted` |
| Hover and pressed | `--ui-surface-hover`, `--ui-surface-pressed` | `bg-ui-hover`, `bg-ui-pressed` |
| Main text | `--ui-foreground` | `text-ui-foreground` |
| Secondary and subtle text | `--ui-foreground-muted`, `--ui-foreground-subtle` | `text-ui-mutedText`, `text-ui-subtle` |
| Borders | `--ui-border`, `--ui-border-strong` | `border-ui-border`, `border-ui-strong` |
| Primary action | `--ui-primary`, `--ui-primary-hover`, `--ui-primary-pressed` | `bg-ui-primary`, `bg-ui-primary-hover` |
| On primary | `--ui-on-primary` | `text-ui-on-primary` |
| Focus ring | `--ui-focus`, `--ui-focus-offset` | `ring-ui-focus` |
| Error | `--ui-danger`, `--ui-danger-hover`, `--ui-danger-surface` | `text-ui-danger`, `bg-ui-danger-surface` |
| Feedback | `--ui-success`, `--ui-warning`, `--ui-info` | `text-ui-success`, `text-ui-warning`, `text-ui-info` |
| Overlay | `--ui-overlay` | `bg-ui-overlay` |
| Elevation | `--ui-shadow-soft`, `--ui-shadow-popover` | `shadow-ui-soft`, `shadow-ui-popover` |
| Radii | `--ui-radius-sm`, `--ui-radius-md`, `--ui-radius-lg` | `rounded-ui-sm`, `rounded-ui-md`, `rounded-ui-lg` |
| Motion/disabled | `--ui-duration`, `--ui-ease`, `--ui-disabled-opacity` | CSS variables |

Keep legacy `.btn*`, `.card*`, `.input`, `.label`, `.section-header`, existing `ink-*`, `chesscom-*`, `move-*`, and Chessground board selectors functional as other agents migrate incrementally. New components should use semantic tokens rather than fixed light/dark hex values.

### Fonts and redistribution

`Patzer Sans` = bundled Inter WOFF2 regular, semibold, bold and italic. `Patzer Mono` = bundled JetBrains Mono regular WOFF2. These are self-hosted under `web/public/fonts` (no runtime CDN or Google Fonts). Notices: `INTER-LICENSE.txt` and `JETBRAINS-MONO-LICENSE.txt`, both SIL Open Font License 1.1. `font-display:block` on our custom font faces prevents a visible system-font swap. Standard font stacks intentionally do not include `system-ui`, Arial, Segoe UI, ui-monospace or generic families. Keep the font notices when shipping binaries.

### Reusable TSX components

Import from `web/src/components/ui`:

- `Button({ variant?: 'primary'|'secondary'|'ghost'|'danger', size?: 'default'|'sm'|'icon', loading?, ...buttonProps })` — visible focus, busy and disabled semantics.
- `Input({invalid?,...inputProps})`, `Select({...selectProps})`, `Textarea({...textareaProps})` and `Field({id,label,hint?,error?,children,className?})` — pass the same `id` to the field and input.
- `Card({interactive?,...divProps})`, `Badge({tone?:'neutral'|'success'|'danger',...spanProps})`, `Spinner({label?})`, `Skeleton({className?})`.
- `Dialog({open,onOpenChange,title,description?,children,footer?})` — native modal dialog/top-layer keyboard behavior.
- `Tabs({items:[{value,label,content,disabled?}],value,onValueChange,label?})` — ARIA tabs and left/right/Home/End navigation.
- `Tooltip({label,children})` — hover/focus text; label icon-only child controls with their own `aria-label`.
- `Popover({trigger,children,label?})` and `Menu({trigger,items:[{id,label,disabled?,onSelect}],label?})` — menu arrow/Home/End navigation, close with Escape/outside click.

All new SVG-based UI primitives use lucide-react and no emoji glyphs. CSS styles native inputs/selects/checkboxes/radios/ranges/file pickers, tooltips, menus, dialogs, scrollbars, focus/error/loading and reduced motion. High-contrast forced-colors support preserves native checkbox/radio affordances; it does not disable appearance on every element.

### CI certification

`web/tests/design-system.contract.test.mjs` checks semantic coverage, local assets and licenses, no system font stacks, bootstrap, native-controls and accessible primitives. `.github/workflows/design-system.yml` runs against PRs targeting `feat/patzer-frontend-overhaul` and `main`: static contracts, TypeScript/Vite build, and Playwright Chromium computed styles of light default under OS-light and OS-dark, explicit dark/light and Auto, custom font loading, control appearance, contrast, focus and reduced motion. Browser assertions exercise the production CSS without a backend fixture by blocking React JS while preserving the synchronous theme head script; Agent 00 must additionally run full integrated backend profile tests after changing new-profile defaults.

Out of scope: emoji avatar/kid-mode rendering in Settings or other agent-owned screens; those owners must migrate them independently. This PR does not certify their work. Existing CI must remain intact and independent QA must approve before integration.