# Agent B — Product Design, Navigation & Visual Excellence

## 2026-11-12: isolated shell improvement cycle

- Branch: `agent/patzer-design-system-shell-20261112`
- Worktree: `patzer-agent-design-20261112`
- Starting revision: `5b5fe22` from `origin/feat/review-polish-product-excellence-20261111`
- Isolation: original review-polish worktree has independent uncommitted Game Review changes; none were modified or carried into this branch. No main merge, deployment or production game-data changes.

### Inspected

- Authenticated routes, app shell, mobile drawer, homepage, shared styles and existing navigation tests.
- Existing shell has a stable 80px desktop rail, focus-trapped mobile drawer, ten primary destinations, and a full-width Game Analysis workspace; retained those features.
- Nested destinations lacked a direct visible parent link in the global header; lazy-route loading displayed a hard-coded unbranded English message.
- Font faces hid content during loading; hero entrance did not explicitly honor reduced motion.

### Implemented

1. Contextual breadcrumbs for Game Analysis and Player Profile, with parent links and current-page semantics.
2. Accessible page-loading fallback with Patzer identity and translated text; respects reduced motion.
3. `font-display: swap` for Patzer font faces.
4. Homepage hero uses `useReducedMotion`.
5. Breadcrumb regression assertions.

### Validation

- Isolated `npm ci`: passed.
- `npm run build -w web`: passed.
- Navigation Vitest suite: 12/12 passed.
- `git diff --check`: passed.
- Browser screenshot harness exists, but Playwright was not installed in the fresh checkout and installation was not completed. Browser/viewport certification remains pending.

### Next

- Run real browser checks at 1920x1080, 1440x900, 1024x768, 390x844 and 320px with both themes, accessibility, scroll overflow and reduced motion.
- Verify translated nested breadcrumbs on narrow mobile and continue shared-shell improvements; keep feature internals owned by other agents unchanged.

## 2026-11-12: completed browser certification and first-run experience cycle

### Recovered

- Resumed the precise `a83b220` clean branch and outstanding Playwright validation from the prior cycle, keeping all other agent worktrees unmodified.
- Finished restoring the optional Playwright harness in a worktree-local, ignored `node_modules/.agent-b-browser` directory, without changing the checked-in dependency manifest. A normal top-level `npm install playwright` temporarily brought in two incompatible React versions; a clean `npm ci` restored **React 18.3.1** at the root and web package.

### Browser findings and fixes

1. Initial desktop dark-theme screenshot revealed illegible secondary text across home activity cards. Moved card label, metadata, and description text to theme-aware `ui` tokens; browser checks now assert a **minimum 4.5:1 contrast** for home activity captions.
2. Empty-game homepage was just a sentence, followed by lots of blank desktop space. Replaced it with a guided two-action first-run panel (Play and Import Games) with usable links, clear explanation, and a note showing where games will appear. Balanced desktop column widths.
3. Initial mobile screenshot showed learning tiles above the first-run onboarding. Ordered onboarding before activity recommendations at all widths, and added a browser regression assertion at 320/390px.
4. Previous breadcrumb parent `NavLink` incorrectly received an implicit `aria-current="page"` in addition to the child page label. Switched the breadcrumb parent to an ordinary `Link`; now exactly one item in the breadcrumb is marked current. Added Vitest assertions and German 320px browser checks for `/players/42` and `/review/42`.
5. Shell UI labels (skip link, mobile drawer, breadcrumb, route-loading text) relied on English fallback for all supported languages. Added `navigation` translations for en/de/es/ru/bg. Updated the public-facing hero copy to describe Patzer's own progress mission rather than calling itself a clone.
6. Reduced-motion handling extends to the home continuation and recent-game entrance animations. The browser harness also checks keyboard skip link position and modal drawer behavior.
7. Browser script now starts a direct Vite child process (instead of an orphanable npm wrapper), uses a dedicated local port `4186`, exercises light and dark screens at **1920x1080, 1440x900, 1024x768, 390x844 and 320x700**, and captures reproducible screenshots under the ignored `artifacts/agent-02/` folder.

### Validation

- `npm run build -w web`: **pass** after final implementation (TypeScript + Vite).
- `npx vitest run web/src/components/navigation/Layout.navigation.test.tsx web/src/locales/locales.test.ts`: **53/53 passed** (12 navigation + 41 locale tests).
- `node web/src/components/navigation/capture-shell.mjs`: **passed** against an authenticated Chromium API-fixture harness, 10 viewport/theme combinations, mobile drawer, contrast, keyboard skip link, two nested German breadcrumbs and admin navigation. Browser snapshots visually inspected at both 320px and 1440px.
- `git diff --check`: **pass**.
- No live backend or external account end-to-end certification; this is frontend-browser fixture verification only.

### Next high-impact area

- Audit unauthenticated landing/authentication shell to ensure newcomers understand Patzer before signing in and can navigate account recovery smoothly. Use real screenshots; no unnecessary redesign.
- Continue interaction, responsive, keyboard and error-state audits only for shared shell and homepage; never edit Game Review, Games Library, Imports, Play or Insights internals.

## 2026-11-12: Auth landing, account entry, and dark/light continuity

### Verified findings

- Public `/login` at 1440px was a narrow centered form with substantial unused space and no clear articulation of Patzer's benefits. Login duplicated the visual frame used by signup and the recovery routes.
- Anonymous browser sessions forced a light theme even when the system preferred dark; legacy helper text on dark auth pages was hard to distinguish.
- Several signup, forgot-password, reset-password, and email-verification input fields had adjacent visual labels but no `htmlFor`/`id` association.
- Registration could briefly render editable inputs on a server that ultimately reports signup disabled; the login form was already guarded against SSO-only flash.
- Authenticated and public hero copy had been updated previously, while the public HTML description and installable-app manifest still compared the product directly to Chess.com.

### Implementation

1. Consolidated authentication presentation in `web/src/components/AuthShell.tsx`. Sign-in alone uses a useful two-column desktop orientation with distinct Patzer graphics, benefits, and prominent credential panel. Narrow screens keep a compact form-first design; signup and recovery continue to share the same branded frame without extra decorative clutter.
2. Preserved existing auth API endpoints, server-driven signup/SSO capability logic, credential submission and error handling while moving `/login` onto the shared shell. Pending capability checks show an accessible loading state rather than a password-form flash.
3. Implemented a compact, keyboard-accessible, single-selected 5-language selector shared by all auth pages; translated the new informational copy for `en`, `bg`, `es`, `de`, `ru`.
4. Public theme bootstrap now respects saved theme or anonymous OS preference; signed-in theme continues to follow the user profile. Remembered theme persists across logout for a consistent return to the sign-in page; OS theme changes update the anonymous page live.
5. Scoped a legacy text-color contrast bridge under `.auth-shell` instead of changing global chess UI colors, and paired previously disconnected auth labels and inputs.
6. Deferred registration controls until `/api/auth/config` is loaded; closed-signup servers show a message and sign-in route without exposing nonfunctional fields.
7. Removed incidental third-party GitHub promotion from the authentication frame; aligned HTML and PWA manifest descriptions with Patzer's own identity, and the default PWA background with the light theme.
8. Added an isolated real-Chromium `web/src/components/navigation/capture-auth.mjs` regression harness. Includes SSO-only/closed-signup delayed capability checks, preference restoration, dark/light and media changes, 1440/1024/390/320px visual captures, input labeling, helper/link contrast, scroll overflow and account recovery.

### Verification

- `npm run build -w web`: **pass** (TypeScript + Vite).
- `npx vitest run web/src --maxWorkers=2`: **375/375 passed across 60 files**. Old Login and Home test-only Framer mocks were extended for the existing reduced-motion hook and `motion.main` wrapper; no production test logic was weakened.
- `node web/src/components/navigation/capture-auth.mjs`: **pass** (mocked public auth capabilities, local Chromium; does not submit credentials or call real services).
- `node web/src/components/navigation/capture-shell.mjs`: **pass again** after the shared theme/bootstrap changes.
- Screenshots for both themes and mobile/desktop are reproducible locally under ignored `artifacts/agent-02/`; inspected 1440px and 320px output and corrected dark helper text based on them.
- `git diff --check`: **pass**.

### Remaining focus

- The signed-in navigation shell and auth shell are frontend-fixture certified, not live-production certified. Check further translations, responsive keyboard focus, error/empty states and contrast where the running application reveals actual problems.
- Ownership remains only on the common shell, homepage, shared styles and public authentication frame. No modifications to other agents' Game Review, Games Library, Play or Insights internals, and no merges, deployments or production-data operations.

## 2026-11-12: Narrow-mobile nested-navigation correction

- **Verified issue:** German `/review/42` at 320px truncated the page name to `Parti…` in the top bar. The parent breadcrumb consumed most of the available space next to the logo, search and menu controls, making the current context ambiguous.
- **Fix:** On sub-768px screens, render the parent as an accessible, focusable back-arrow link with a screen-reader-only parent name; keep the full parent + separator + child breadcrumb on desktop. The current title is now prominent without a second header row or moving global controls.
- **Browser regression:** `capture-shell.mjs` now asserts 320px German current title is not clipped (actual scroll versus client width), the parent back affordance exists, clicking it changes to the correct parent URL, and the screen has no horizontal overflow. Both nested Review and Player Profile paths are covered.
- **Validation:** `node web/src/components/navigation/capture-shell.mjs` **passed** the full light/dark responsive smoke; inspected the regenerated `breadcrumb-review-320-de.png` showing complete `Partiedetails`. `npm run build -w web` **passed**; 60 focused tests across navigation, login and locales **passed**.
- **Next:** Continue auditing meaningful cross-app shell problems: mobile keyboard and focus behaviors, global header search/keyboard shortcuts, and localized empty/error states. Leave all other agent feature internals untouched.

## 2026-11-12: Global search and keyboard overlay reliability

### Recovered and reproduced

- Recovered clean Agent B branch at `bd04a5a` and resumed the specific pending global command-palette/shortcuts-modal audit, without restarting completed homepage or auth investigations.
- Added a dedicated authenticated **Chromium fixture** harness for these overlays. The first pre-change run failed when attempting to find the command palette by accessible dialog name: the existing modal had none.
- Source inspection also confirmed that palette and shortcuts dialogs lacked focus traps/restoration, that the palette's global capture listener intercepted Enter from anywhere (including focused buttons), and that Ctrl+K could stack the palette on top of the shortcuts modal.
- Actual dark 320px screenshots exposed low-contrast icons, section headings and keyboard hints in both global overlays.

### Changes

1. Added a reusable `useDialogFocus` hook for both shared overlays: focus enters on open, Tab and Shift+Tab remain inside, Escape closes, and closing restores the original focus where it still exists. External focus attempts also return inside an active dialog.
2. The command palette now has an accessible dialog name and search combobox/listbox semantics, a keyboard-exposed active option, screen-reader-selected status, proper search-result empty state, and keyboard navigation only while the search input is active. Focused option buttons regain their normal Enter behavior.
3. The keyboard-shortcuts modal now has a named dialog, a named close button and an initial focus target, alongside the shared focus/restore behavior. Both dialogs avoid displaying entrance animation when reduced motion is requested.
4. The global Ctrl+K shortcut now closes the shortcuts modal before opening the palette; global `?` and `g X` navigation shortcuts are suppressed while either modal is active, preventing background navigation and competing focus traps.
5. Migrated only the two global overlays' foregrounds, secondary text, borders and interactive surfaces to semantic, theme-aware `ui` tokens. Their dark-mode headings, hints and icons are visibly readable rather than nearly black on dark cards.
6. Added browser regression coverage in `capture-global-dialogs.mjs` with fixture auth, 1440px / 390px / 320px light and dark screenshots, scroll-overflow checks, measured minimum 4.5:1 secondary-text contrast, repeated Tab focus containment, Escape restore, command action selection and empty results, arrow active selection, mobile shortcuts, and prevention of simultaneous global modals.
7. Added two isolated Vitest tests for the focus-management hook (Tab/Shift+Tab wrap and Escape with original-focus restoration).

### Verification

- `npm run build -w web`: **passed**, TypeScript and Vite production frontend.
- `npx vitest run web/src --maxWorkers=2`: **377/377 passed across 61 test files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed** with real Chromium in both themes and all tested viewport sizes; screenshots inspected at 320px and 1440px.
- `node web/src/components/navigation/capture-shell.mjs`: **passed again** (authenticated global navigation and homepage responsive checks).
- All browser checks used local fixtures, no live game requests or production data. No merge, deployment, or modifications to other agents' feature internals.

### Next audit

- Continue inspecting shared global loading/error navigation experiences and modal interactions in narrow screens, including interrupted navigation and low-bandwidth states. Keep changes limited to Agent B's shell/design ownership and require real browser evidence before editing.

## 2026-11-12: Release notes and update notice usability

### Recovery and verified problems

- Resumed from clean pushed `e674b79`, with previous focus/keyboard fixes preserved and without touching other agents' checkouts.
- Audited `ChangelogModal`, `UpdateNotice`, global initial loading and the release metadata API; confirmed the changelog endpoint can return an empty markdown body and the old UI rendered a completely blank panel on 503 errors.
- Created a real Chromium API-fixture harness. Its **pre-fix run failed** because failed release-notes requests never surfaced an error message, even though the modal remained visible.
- Screenshot audit revealed a hard-coded English changelog heading, weak mobile presentation, and a release-banner dismissal target smaller than typical touch accessibility guidance. Technical update instructions were shown to ordinary players who cannot administer the self-hosted server.

### Implementation

1. Replaced blank changelog failures with a named, accessible error state and a working retry action; successful empty changelogs display a clear non-error explanation.
2. Safely aborts in-flight changelog requests on unmount and when retrying; stale responses cannot replace newer results. Handles non-2xx responses correctly instead of treating their bodies as release notes.
3. Reused the shared `useDialogFocus` behavior: initial close-button focus, contained keyboard navigation, Escape dismissal and focus restoration. Mobile uses a rounded, scrollable bottom sheet with accessible 44px close control, while desktop stays a centered panel.
4. Added localized changelog title, loading, error, retry, and empty-state copy for all five supported languages (English, German, Spanish, Russian and Bulgarian).
5. Scoped readable markdown link styles to the release-notes content without altering other Markdown consumers or chess-coaching internals.
6. Enlarged the update notice dismiss control for mobile and limited technical container-update instructions to administrators. The notice remains dismissible per release.
7. Added `web/src/components/navigation/capture-notices.mjs`: authenticated local Chromium API-fixture checks at 1440px, 390px and 320px in both themes, changelog success/error/empty/retry/long-scroll states, focus trapping/return, 44px touch target, role-aware technical copy, dismissal persistence, and reappearance for a later release.
8. Added `web/src/components/ChangelogModal.test.tsx` covering HTTP failures and retry, empty notes, and cancellation of outstanding requests.

### Verification

- `npm run build -w web`: **passed** (TypeScript + Vite).
- `npx vitest run web/src --maxWorkers=2`: **380/380 passed across 62 test files**.
- `node web/src/components/navigation/capture-notices.mjs`: **passed**, real Chromium with isolated API fixtures. Inspected 320px dark and 1440px light screenshots.
- No real account, production service, external deployment, database or other agent branch was modified.

### Next verified-audit target

- Initial authentication/bootstrap loading and failed capability checks: confirm readable/accessible global loading status and any actionable server-unavailable guidance in a real browser before implementing further changes.

## 2026-11-12: Honest startup and server-unavailable experience

### Reproduced

- Resumed from clean pushed `64e783d`, leaving earlier release-notes work complete.
- Found a misleading bootstrap failure: the auth store distinguishes API failures by setting `setupRequired = null`, but `App.tsx` previously interpreted every nonloading, non-setup state with `user = null` as logged-out. When either `/api/setup/status` or `/api/auth/me` returned 503, the UI redirected to sign-in rather than explaining the outage.
- The initial Patzer splash had only a logo and animation, without visible status text or a screen-reader status name.
- Created the real local Chromium fixture at `capture-bootstrap.mjs`; its **pre-fix run failed** because the server-unavailable alert and retry button did not exist.

### Fixes

1. Introduced a branded, responsive `ServerUnavailable` shared-shell screen that clearly explains failed server contact instead of falsely implying logout. It provides a keyboard-operable **Try again** action that invokes the existing auth refresh, guards against duplicate retries, and returns to the real sign-in/setup/app route after successful recovery.
2. Made the initial splash a labeled live status with visible, translatable "Starting Patzer…" copy and reduced-motion-safe animation, using Patzer's theme-aware foreground and background tokens.
3. Added startup/loading/unavailable/retry translations in all five supported locales.
4. Added focused component tests for outage copy, retry behavior, and prevention of concurrent retry clicks.
5. Added browser certification across 1440/390/320px in light/dark themes for both setup and session endpoint failures, with recovery, startup status, overflow and screenshot checks.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **382/382 passed across 63 files**.
- `node web/src/components/navigation/capture-bootstrap.mjs`: **passed** with real Chromium and simulated endpoint outages and recovery; visually inspected 320px dark outage, 1440px light outage and dark initial-loading screen.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** again.
- `node web/src/components/navigation/capture-auth.mjs`: **passed** again.
- All tests use local API fixtures, not real credentials, live services or production data. No merges, deployments or edits in other agents' branches.

### Next verified-audit target

- Investigate `/api/auth/config` capability-probe failures. The current fail-closed defaults suppress signup and SSO but may still render a password form despite an unreachable or SSO-only server; inspect and improve any misleading state, preserving the server's authoritative capability contract.
