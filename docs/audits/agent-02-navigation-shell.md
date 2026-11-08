# Agent 02 — Navigation and application shell

## Baseline audit

Audited main at 31b6e55f0762d23f9cad738b05174815acd37ed1. The old shell used a horizontal nav that dynamically hid text labels as available width changed and constrained every route to max-w-7xl. The latter is incompatible with a 40–50% board plus right-side analysis panel.

The application routes defined in App.tsx are: /, /play, /review, /review/:id, /insights, /train, /learn, /openings, /plan, /players, /players/:id, /lab, /settings, and administrator-only /admin/users and /admin/system. All remain reachable; routes and the associated backend authorization are unchanged.

## Implementation and behavior

- Desktop navigation is an 80px fixed-width rail at viewport widths of 768px and above. The ten primary destinations remain visible via compact SVG icons and short labels. Translated accessible names are never truncated for assistive technology; a native title provides a pointer tooltip. Long visual text is ellipsized rather than growing the rail. The rail scrolls vertically on short screens, with settings anchored at its bottom.
- The 56px workspace header includes section title, command palette and shortcuts triggers, language selector, profile/settings link, and logout. Existing global shortcuts and their modals remain owned by App.tsx; UpdateNotice, changelog and version footer are preserved.
- Mobile navigation uses a drawer with all destinations, settings, five language choices, profile, shortcuts and logout. Admin destinations are only present for admin users. Escape, backdrop, route change and crossing the desktop breakpoint close the drawer. Keyboard focus stays inside while open and returns to the trigger when closed.
- No emoji navigation or avatar elements are rendered by this shell. Visual icons are Lucide SVG. The component uses existing light/dark utility classes and semantic Tailwind variants to work with Agent 01's theme changes, without touching global CSS, App.tsx or fonts.
- Navigation uses React Router NavLink, retaining aria-current state on /review/:id and /players/:id. A skip-to-main link and focus-visible outlines support keyboard users.

## Contract for Agent 03 — analysis workspace

Layout is structured as:

~~~html
<div data-app-shell>
  <aside data-navigation-rail>...</aside>
  <div data-workspace="analysis">
    <header data-workspace-header>...</header>
    <main data-shell-main>
      <div data-workspace-content>...GameAnalyzer outlet...</div>
    </main>
  </div>
</div>
~~~

The data-workspace value is analysis for /review/:id, and default on other routes. For analysis the content container is full width, min-w-0, min-h-0, flex column, flex-1 and max-w-none. Horizontal padding is 12px on mobile and 20px on >=640px; other routes retain max-w-[1440px].

Agent 03 can rely on approximately viewport width minus 80px rail minus 40px horizontal content padding on a laptop. At 1440px viewport width, the available content width is approximately 1320px. At 1024px, approximately 904px. Those are container widths, not promised board widths. Agent 03 determines the board/panel split and must account for height, engine elements and smaller screens, without changing the shell.

The header is 56px tall, and the footer/update notice may occupy additional height. Do not assume viewport height equals board height.

## Validation

- Layout.navigation.test.tsx exercises 10 routes, nested active state, admin gates, mobile navigation, route transitions, Escape/Tab/focus restoration and resize teardown, language selector, palette/shortcuts, profile, logout, version, long translations, and theme class contracts.
- capture-shell.mjs launches the real Vite frontend in headless Chromium with mocked API responses, checks horizontal overflow at desktop/laptop/mobile widths, checks primary routes and admin links, verifies mobile Escape and resize behavior, and captures 5 screenshots: desktop light, laptop light, desktop dark, mobile light drawer, desktop admin.
- agent-02-shell.yml runs locked npm install, full typecheck, all unit tests, web build and browser screenshots on branch pushes and PRs against the integration branch. It uploads screenshot artifacts for Agent 00 to inspect.

The screenshot browser harness uses mock authentication and API fixtures for visual certification; it is not a substitute for real-server end-to-end tests. Final integration must pass the original main CI and real-browser regression gates at the exact merged candidate HEAD.

## Ownership and integration checkpoints

Agent 02 owns only Layout.tsx, the new navigation tests/browser harness, its dedicated CI workflow and this audit. No production backend, global CSS, App.tsx, GameAnalyzer.tsx, Logo.tsx or shared sound components are modified.

Agent 01 must confirm styling/token/font/focus contrast compatibility after its design system merges.
Agent 03 must verify 1024px and 1440px board/panel proportions and ensure analysis content uses available width; no shell max-width forces a narrower analysis board.
Agent 07/00 must inspect screenshots and verify real keyboard, resize, administrator-permission and no-overflow behavior. Do not merge this branch without exact-head CI evidence.
