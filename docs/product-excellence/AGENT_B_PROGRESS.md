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

## 2026-11-12: Authentication capability-probe failure and recovery

### Recovery and reproduction

- Recovered the clean, pushed Agent B worktree at `1ae6926` and resumed the exact outstanding `/api/auth/config` failure task.
- Before editing, expanded the actual Chromium auth fixture to return HTTP 503. The regression failed because the login form appeared instead of a named error; on SSO-only installations that falsely offers password sign-in. Also verified a malformed HTTP 200 response should not be treated as valid capabilities.

### Changes

1. `useAuthConfig` explicitly separates **loading**, **ready** and **error** states, validates the complete public server capability payload, ignores responses after cleanup, and exposes an in-place retry. Passwords, SSO, signup and recovery affordances are hidden until a successfully validated response is available.
2. Added a reusable, accessible `AuthOptionsUnavailable` presentation for sign-in and registration with understandable error text and a clear **Try again** action, rather than misleading disabled-signup/password-fallback states.
3. On signup, deferred invite-code validation until the server has confirmed registration is enabled; no needless invitation API calls occur while the capability check is pending or unavailable.
4. Localized capability failure, explanation and retry affordances across English, German, Spanish, Russian and Bulgarian.
5. Added unit coverage for HTTP failures, malformed response behavior, retry into SSO-only, recovery into open registration, genuine registration-disabled results, and invite-probe gating.
6. Expanded `capture-auth.mjs` to test both 503 and malformed responses at 1440px and 320px in both themes, retry recovery, SSO-only and signup behavior, no horizontal overflow, and a live switch to longer German error text.

### Validation

- `npm run build -w web`: **passed**, TypeScript + Vite.
- `npx vitest run web/src --maxWorkers=2`: **387/387 passed across 64 test files**.
- `node web/src/components/navigation/capture-auth.mjs`: **passed**, including new failure/retry matrix. Visually inspected English and German dark-theme 320px error screenshots.
- No production credentials, servers or game data were used. Other agents' feature branches/worktrees were untouched; no merge or deployment.

### Next audit

- Verify how the public sign-in shell behaves when a capability-probe request **never resolves** rather than returning an HTTP error; investigate a bounded, abortable request with explicit retry instead of potentially infinite loading. Preserve server-driven SSO/signup rules.

## 2026-11-12: Bounded authentication capability requests

### Reproduction

- Recovered the clean Agent B branch at `820f016` and completed the exact pending indefinite-request investigation; no completed earlier work was repeated.
- Extended `capture-auth.mjs` with a simulated `/api/auth/config` response delayed for 20 seconds. **Before the fix, Chromium failed after 13 seconds:** the login page still showed a loading skeleton, with no way to recover. Signup had the same unbounded wait.

### Implementation

1. Added an **8-second maximum** for the public capability probe. Expiration aborts the outgoing fetch and switches to the already localized, accessible in-place retry UI; password and SSO controls remain hidden until authoritative server capabilities arrive.
2. Extended the shared `api.get` signature with an optional `RequestInit`, preserving the existing default request headers and behavior for all existing callers. Only this public capability probe currently passes an `AbortSignal`; no feature pages were edited.
3. Ignored late responses from expired/unmounted requests so a stale response cannot revive an obsolete sign-in form or overwrite a newer retry.
4. Added unit tests for stalled requests, timeout-driven abort, retry, and stale responses; expanded real Chromium tests to verify the stalled-sign-in and stalled-signup recovery journeys on an SSO-only/open-signup fixture.

### Validation

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **389/389 passed across 65 files**.
- `node web/src/components/navigation/capture-auth.mjs`: **passed** including two real eight-second timeouts and recovery. No actual accounts or external APIs used.
- `git diff --check`: **passed**.

### Next audit

- Apply the same evidence-driven standard to **initial app bootstrap**. A hanging `/api/setup/status` or `/api/auth/me` request may hold the global `Starting Patzer…` splash indefinitely even though ordinary HTTP errors now have a useful recovery screen. Investigate in isolation before changes.

## 2026-11-12: Bounded startup and safe auth-state refresh

### Reproduced

- Resumed from clean pushed `f60ae48` and investigated exactly the pending global startup issue.
- Extended real Chromium `capture-bootstrap.mjs` with a simulated 20-second stall at both `/api/setup/status` and `/api/auth/me`. **Before the fix it failed after 15 seconds:** the global `Starting Patzer…` splash remained stuck without an outage message or retry.

### Changes

1. Added a **single 10-second deadline** spanning both startup requests in the shared auth store. On expiry, the active request is aborted and the app displays the existing translated, accessible `ServerUnavailable` retry screen instead of hanging.
2. Retained legitimate first-time setup handling, authenticated responses, and sign-in flow. Invalid server status payloads also report a connection/status failure instead of silently treating malformed data as a logged-out session.
3. Added a refresh generation guard and cancellation of older requests. Concurrent startup checks (including React StrictMode remount behavior), late responses after timeouts, and stale previous retries can no longer overwrite newer auth state.
4. Added four isolated auth-state unit tests for hung setup, hung session, overlapping refreshes, and late results after timeout.
5. Expanded Chromium checks for both stalled endpoints and retry recovery. All browser fixtures are local; no live authentication or game data was contacted.

### Validation

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **393/393 passed across 66 files**.
- `node web/src/components/navigation/capture-bootstrap.mjs`: **passed** including delayed setup/session request recovery; visually inspected the 320px dark outage screen.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**.
- `node web/src/components/navigation/capture-auth.mjs`: **passed** (including expired capability probes).
- `git diff --check`: **passed**.

### Next audit

- Examine the global top-level React Router error presentation. A render exception outside normal API errors may currently expose React Router's generic technical fallback instead of a helpful, branded and accessible recovery path; verify in an isolated fixture before changing the shared router.

## 2026-11-12: Branded, safe top-level route failure experience

### Reproduction

- Resumed from clean pushed `0d77e30`; followed the specific pending router-error audit without altering previously completed improvements.
- Tested an intentionally malformed session response with local Chromium API fixtures. **Before editing**, React Router's default error page displayed `Unexpected Application Error!`, a `TypeError` and full component-stack details. This was observable directly in the browser (not inferred from source).

### Changes

1. Added a light/dark, narrow/desktop responsive `GlobalRouterError` for the shared `createBrowserRouter` boundary. The page provides an accessible, localized heading and readable explanation, along with **Reload page** and **Go home** recovery actions.
2. Deliberately does not render exception objects, stack traces or sensitive server details. The fallback is independent of auth state and feature internals, so it works when auth state caused the original crash.
3. Programmatic heading focus announces the new page to screen readers; a narrowly scoped focus exception avoids drawing a misleading button-style outline on this noninteractive heading, while the actual recovery controls retain their focus indicators.
4. Added translations for the last-resort fallback across English, German, Spanish, Russian and Bulgarian.
5. Created `capture-router-error.mjs`, verifying real Chromium error handling at 1440px/390px/320px in both themes, no exception detail leakage in displayed body text, no horizontal overflow, and recovery to sign-in after reloading against a healthy API fixture.
6. Added React Router integration tests in `GlobalRouterError.test.tsx` with a deliberately throwing route, screen-reader heading, recovery controls, localization and no internal-exception output.

### Validation

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **395/395 passed across 67 files**.
- `node web/src/components/navigation/capture-router-error.mjs`: **passed**, with screenshots inspected at 320px dark and 1440px light.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** after the shared router change.
- `git diff --check`: **passed**.
- Only the isolated Agent B worktree was changed. No production service, real user data, other agent worktree, merge or deployment.

### Next audit

- Inspect the shared first-run setup/onboarding experience at narrow widths, both themes, and keyboard-only navigation. Specifically verify language controls, responsive overflow, accessible labels and reduced motion before editing.

## 2026-11-12: First-use setup, responsive language selection and accessible forms

### Recovery and browser evidence

- Recovered the exact clean Agent B branch at `a44521d` and completed the pending first-use wizard audit without revisiting earlier investigations.
- Reproduced the narrow-mobile failure in real Chromium before editing: the five language buttons had measured right edges at about 115px, 229px, 323px, 420px and 518px on a **320px screen**, making multiple choices unreachable. Each button was only **38px** tall. Setup also lacked programmatically associated field labels and selected-language semantics, and its initial motion did not opt out when reduced motion was requested.
- Baseline screenshots captured under ignored `artifacts/agent-02/`; follow-up captures inspected for 320px dark and 1440px light themes.

### Improvements

1. Rebuilt first-run language selection as a responsive two-column mobile / five-column desktop grid with all five supported languages visible. Accessible grouped buttons have a unique `aria-pressed` selection and **44px minimum touch targets**, including the final language spanning the full final mobile row.
2. Correctly associated labels and inputs for admin username, display name, password, Ollama address and model. Password guidance now uses `aria-describedby`; the two-step progress list identifies the current step.
3. Improved first-run responsive layout with readable dark/light semantic colors, accessible button sizing, vertically scrollable narrow-screen content, and restrained motion that honors `prefers-reduced-motion`.
4. Kept the account/AI setup sequence and backend submission intact. The optional Ollama connection-test button now uses the existing translated text; connection errors are announced using `role=alert`, while successful results use `role=status`.
5. Added `web/src/components/navigation/capture-setup.mjs`, an isolated Chromium test using only mocked setup and Ollama endpoints. It validates 1440x900, 1024x768, 390x844 and 320x700 in light/dark themes, visible 44px language controls, field labeling, step progression, optional-connection errors, returning without losing form values, and German/Russian language changes at 320px.
6. Added three `Setup.accessibility.test.tsx` cases checking field and selection semantics, step navigation and preserved values, and localized selected-language state.

### Verification

- `npm run build -w web`: **passed**, TypeScript and Vite production build.
- `npx vitest run web/src --maxWorkers=2`: **398/398 passed across 68 test files**.
- `node web/src/components/navigation/capture-setup.mjs`: **passed** full Chromium responsive, theme, step-flow and locale matrix.
- `git diff --check`: **passed**.
- Used frontend-only fixtures; did not create an admin account, submit setup, contact a real AI server, touch production, merge any branch or edit any other agent's feature pages.

### Next high-impact shared-shell audit

- Investigate global keyboard focus and page-navigation resilience when returning from emergency errors or first-run setup; verify actual problems before implementing any further shared changes. Continue to leave Games Library, Game Review, Imports, Play and Insights internals to their dedicated agents.

## 2026-11-12: Route focus handoff and first-run step announcements

### Recovered state and reproduced defects

- Resumed the clean, pushed `5d8c709` state and the specific unfinished keyboard/navigation audit; kept all prior validated batches intact.
- In real Chromium, selecting Review from the 320px mobile navigation drawer changed the route but returned keyboard focus to **Open menu**, not the destination. Keyboard navigation from the desktop rail also left focus on the old navigation link.
- The first-run Setup wizard did not move focus to the newly mounted Ollama step heading, so moving forward/back could leave focus on a removed control. An additional back-navigation conflict arose because the username field always used `autoFocus`.

### Implementation

1. On real pathname changes, the shared `Layout` now focuses the newly named main landmark **after** the mobile drawer closes. It resets scroll on fresh push/replace navigation, preserves browser-history scroll on POP and avoids interrupting same-path query-only state changes in chess activities.
2. Kept keyboard behavior consistent across desktop rail, mobile drawer, and the global command palette; these changes do not reach into feature-level pages.
3. On wizard step transitions, `Setup` announces the new heading through a ref callback that waits for `AnimatePresence` to mount the step. Initial username autofocus remains on first launch but no longer steals focus on return to the account step.
4. Added unit assertions for initial/follow-up step focus, desktop/mobile route focus and same-path query-only focus preservation. Extended actual Chromium fixtures to assert route handoff, scroll reset, command-palette navigation focus and both Setup transitions.

### Verification

- `npm run build -w web`: **passed**, TypeScript + Vite production build.
- `npx vitest run web/src --maxWorkers=2`: **400/400 passed across 68 files**.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including real 320px mobile drawer and desktop keyboard route transitions. Inspected desktop navigation screenshot.
- `node web/src/components/navigation/capture-setup.mjs`: **passed**, full theme/viewport/locale setup checks plus step focus handoff.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including command-palette destination focus.
- `git diff --check`: **passed**.
- All browser calls used local mocked APIs; no production service or game data was touched. Other agents' feature files/worktrees remain untouched.

### Next shared-shell audit

- Look for remaining focus and scroll inconsistencies around browser Back/Forward, skip-link activation and the transition from temporary loading to a settled workspace. Preserve feature-level focus and internal move-list navigation; only change shared shell behavior with browser evidence.

## 2026-11-12: Browser history audit and 44px mobile touch targets

### Recovery and investigation

- Resumed the exact uncommitted history-position investigation on clean pushed `b368ecd`, not an earlier design cycle.
- An initial Back-navigation browser check appeared to lose the dashboard scroll position. Investigated React Router's `ScrollRestoration` and a custom position-caching hook, then used a **negative control without either implementation**. The original browser test clicked the header menu after programmatically scrolling to the bottom; Playwright moved the page to bring the menu button into view before leaving the route, changing the expected position. With navigation triggered from the original position using Patzer's real `g r` keyboard shortcut, native browser restoration correctly preserved scroll even on repeated Back/Forward.
- **Decision:** Rejected the custom scroll manager and reverted the experimental `ScrollRestoration` addition. No extra state or potentially competing scroll behavior was shipped. Preserved regression coverage for genuine history navigation and verified skip-link activation.
- A separate real-browser mobile control audit **failed before editing**: the header Open menu button measured only **36 × 36px** at 390px; other small header targets and the drawer close action had the same insufficient touch-target pattern.

### Shipped implementation

1. Enlarged the mobile header's **Open menu**, **Command palette**, and logo home link, plus the drawer's **Close menu** action, to at least **44 × 44px**. Desktop-density control sizing remains unchanged.
2. Tightened mobile-only header gaps to preserve the full nested-page title at 320px alongside the larger tap areas; inspected the 320px German `Partiedetails` breadcrumb screenshot with no truncation.
3. Extended `capture-shell.mjs` to measure all four actual touch-target rectangles at 390px and 320px in both themes, test skip-link Enter focusing the main landmark, and check that repeated Back/Forward returns to the same dashboard scroll position without feature-level changes.

### Verification

- `npm run build -w web`: **passed** (TypeScript + Vite).
- `npx vitest run web/src --maxWorkers=2`: **400/400 passed across 68 files**.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** for all existing viewports and light/dark themes plus the new 44px targets, skip link and native history checks.
- `git diff --check`: **passed**.
- No modifications to Games Library, Imports, Review, Play or Insights internals. No branch merging, deployment or production data changes.

### Next area to inspect

- Audit consistent mobile modal/dialog touch targets and dismiss affordances in the shared shell, and verify narrow-screen orientation/contrast behavior with real browser evidence. Continue design-system and navigation work without modifying feature-owned pages.

## 2026-11-12: Consistent, accessible global-overlay dismissal on mobile

### Recovered and reproduced

- Recovered the exact clean Agent B worktree at `4fc398e` with an unfinished browser fixture that already failed on a missing command-palette Close button. No earlier work was replayed.
- Chromium's 320px global-dialog test confirmed the palette could only be dismissed with Escape or an unlabelled backdrop; it had **no visible, accessible Close control**. The keyboard-shortcuts dialog also had a close affordance below the 44px mobile touch-target standard.

### Implemented

1. Added a clearly visible and accessible **Close** button within the command palette's search row. Its hit target is at least **44x44px** on mobile, retains keyboard focus styling and does not reduce the ability to enter searches on 320px screens.
2. Increased the shortcuts modal's existing Close button to **44x44px**, preserving semantic colors and focus styling.
3. Expanded the real-Chromium `capture-global-dialogs.mjs` fixture with both light/dark 320px and 390px palette close-button measurements, actual click dismissal, focus returning to the opener, and mobile shortcuts close target and click checks.
4. Inspected the new 320px dark theme screenshots for the search field, close icon, global shortcut listings, contrast and no horizontal overflow. Existing Tab trapping, keyboard search, Ctrl+K modal-switching, active-result navigation and Escape checks remain in the browser suite.

### Validation

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **400/400 passed across 68 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed** with real local Chromium at 1440px, 390px, and 320px in both themes.
- `git diff --check`: **passed**.
- No changes in feature-owned pages, production services, other worktrees or game data. No merge or deployment.

### Next audit

- Verify closing the keyboard-shortcuts dialog *after opening it from a mobile navigation drawer* restores an obvious and usable focus target. The source drawer unmounts, so the shared dialog hook's normal return-to-opener behavior may leave keyboard focus on the document body. Investigate in Chromium before changing shared focus behavior.

## 2026-11-12: Short-viewport command palette and mobile focus verification

### Recovered and reproduced

- Continued from clean pushed `85ffdfe`; first checked the documented potential mobile shortcuts focus issue. **Negative control passed:** closing the shortcuts dialog after opening it from the mobile navigation drawer already returns focus to **Open menu**. No unnecessary focus hook changes were introduced.
- Expanded real Chromium testing to short landscape screens at **844x390 and 568x320**, in light and dark themes. Before changes, the palette at 568x320 ended below the viewport (`y=38.39px`, `height=287.94px`), partially hiding its footer.

### Changes

1. Updated the shared command-palette dialog to use a responsive vertical layout with a viewport-height maximum. On screens shorter than 500px, reduced its top offset and reserved bottom space.
2. The search/Close header and keyboard-hint footer remain visible, while results become the independently scrollable area. Restored the existing **60dvh / 32rem** results-height limit for normal desktop screens after the first attempted layout exposed an over-tall desktop palette in screenshots.
3. Added viewport-bound checks at the normal 1440/390/320 widths **and** the two landscape resolutions. Screenshots were inspected for 1440px desktop and 568px landscape in dark/light themes.
4. Confirmed the shortcuts dialog fits the tested landscape viewports, and added a permanent browser assertion for mobile-drawer shortcuts focus restoration.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **400/400 passed across 68 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, all focus, contrast, dismissal and short-viewport bounds checks.
- `git diff --check`: **passed**.
- No changes to other agents' feature pages or branches, real user data, deployment or production systems.

### Next audit

- Inspect shell-level keyboard interaction discoverability and the consistency of shared empty/error states at narrow widths, prioritizing real usability defects over speculative visual changes.

## 2026-11-12: Recoverable global command actions and reliable busy feedback

### Reproduced

- Resumed from clean pushed `b59a448`, without repeating the finished layout/focus investigations.
- Audited the globally available theme actions in `CommandPalette`. A real Chromium fixture returning **503** from `PATCH /api/settings/profile` reproduced a broken experience: the palette stayed open with **no explanation or retry feedback** after the asynchronous action failed.
- The existing Enter/click dispatch paths invoked async `run` callbacks without catching rejections; repeat submissions could be triggered while the first update was still in flight.

### Implementation

1. Routed keyboard Enter and option-button clicks through one guarded, async-aware command executor. It catches failures and presents a **localized, accessible inline error**, never exposing raw server errors or stack traces.
2. Added a visible `role=status` progress state and `aria-busy` while an action runs. The executing palette disables its options and ignores repeated Enter until the active operation completes; Close remains accessible.
3. Failed actions remain searchable and retryable without reloading. Search edits clear stale action errors; returning to a newly opened palette clears previous errors.
4. Added progress/failure translations in English, German, Spanish, Russian and Bulgarian.
5. Extended the real Chromium dialog fixture: a 503 theme update must expose an alert while remaining open, retry must succeed against a slow successful response, pressing Enter twice must send **exactly one retry request**, and the palette should close only after the theme/profile refresh succeeds.
6. Added two focused `CommandPalette.actions.test.tsx` cases for click failure and retry, keyboard Enter with an in-flight promise, and suppression of duplicate requests.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **402/402 passed across 69 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including the new simulated 503, delayed retry and action-submission safety assertions.
- Inspected the 390px light-theme error screenshot: message remains visible, result remains selected, and both the input and Close button are accessible.
- `git diff --check`: **passed**.
- All browser API responses were local fixtures; no production settings, other agent branches, deployments or game records were modified.

### Next investigation

- Audit global navigation behavior when the user changes language from the command palette and when the app shell is in temporary loading or empty states. Prefer reproducible focus, selection or discoverability failures rather than speculative component restyling.

## 2026-11-12: Command palette language discoverability

### Verified defect

- Recovered clean pushed `0c576e3` and investigated the next documented global navigation discoverability target.
- In real Chromium, typing **German** into the English command palette produced no `Deutsch` action, because language search only included a native-language name and ISO code. This also affected searches for **Russian**, **Spanish**, and **Bulgarian** and Latin-script input without accent marks.

### Implementation

1. Kept the native labels from the shared `LANGUAGES` registry visible, preserving the safety and familiarity of choosing a language even when the interface is set to an unfamiliar locale.
2. Scoped English language-name and common Latin transliteration keywords to `CommandPalette` only; no shared language registry or feature-owned pages were modified.
3. Normalized search terms and indexed labels with Unicode NFKD and combining-mark removal so `espanol` finds `Español`, while the existing exact native forms still match.
4. Expanded real Chromium command-palette checks at 320px for German, Russian, Spanish, accent-free Spanish and Bulgarian queries, followed by an actual German-language switch that updates the global palette affordance.
5. Added a focused unit test for those aliases and successful language switching, alongside the existing asynchronous-action failure/retry tests.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **403/403 passed across 69 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including alias searches, actual language switch, 320px layout, dialog focus, and all earlier responsive/error-state checks.
- `git diff --check`: **passed**.
- No other agent worktrees, production services, real user data, merges or deployments were touched.

### Next audit

- Continue investigating global keyboard-search navigation and shared loading/empty/error state discoverability on 320px mobile and desktop. Focus on substantive problems verified by Chromium; avoid feature internals or speculative CSS changes.

## 2026-11-12: Persist global language selections across reloads

### Recovery and actual-browser reproduction

- Recovered the **clean, pushed `dd4d239`** Agent B branch and followed the documented global-navigation/localization audit. Did not repeat earlier command-palette searches, design investigations or other agents' work.
- Real Chromium negative control: selecting **Deutsch** through the command palette immediately translated the shell, but a full reload restored the original profile language. Both the command palette and desktop/mobile header selectors previously called `i18n.changeLanguage()` only, never persisting the user's choice.
- The existing `PATCH /api/settings/profile` server contract already accepts an optional `language` and returns the saved user profile; no server changes were required.

### Implementation

1. Added a scoped shared `saveInterfaceLanguage` helper used by the global palette and both header language selectors. It PATCHes the chosen language, validates the saved response, updates the existing signed-in user without a whole-app auth refresh, and applies the new locale.
2. Serializes global language changes so delayed earlier requests cannot overwrite a more recent choice. Guards against account switches and preserves unrelated profile updates made while an operation was in progress.
3. The desktop/mobile header selectors are disabled while saving; on failure, they retain the previous language and show a dismissible, accessible, localized error instead of silently losing the preference. The mobile selector also meets the 44px touch-target minimum.
4. The palette reuses the earlier shared busy/error/retry framework for failed language writes. Kept recognizable native-language labels and search aliases unchanged.
5. Added all five localizations of the header failure text, five focused helper tests for persistence, concurrent settings updates, failure/retry, account isolation and sequential changes. Existing navigation/palette tests now mock only the new preference helper, preserving their separate interaction scope.
6. Expanded real Chromium's mobile dialog fixture to verify a successful palette German-language switch persists after reload; a 503 from the drawer selector does not change the profile and displays a German alert; a subsequent Spanish retry persists and survives another reload. Inspected the 320px dark-theme failure overlay for readable presentation and overflow.

### Verification

- `npm run build -w web`: **passed** (TypeScript + Vite).
- `npx vitest run web/src --maxWorkers=2`: **408/408 passed across 70 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including new persist/reload and 503/retry tests plus prior keyboard, modal, contrast and landscape coverage.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, full existing 1920/1440/1024/390/320 responsive shell checks.
- `git diff --check`: **passed**.
- The browser used mocked local endpoints only. No production API, game data, other agent branch/worktree, merge or deployment was touched.

### Next audit

- Inspect actual global loading and empty states and command-palette keyboard navigation for a new user. Prioritize robust discoverability and graceful feedback with real Chromium reproduction; leave feature-owned flows to their designated agents.

## 2026-11-12: Explain recent-game search loading, empty and outage states

### Recovery and reproduction

- Resumed the exact clean pushed Agent B commit `f384f3e`, and finished the previously interrupted palette-game search audit without repeating earlier completed UX improvements.
- Real Chromium fixture returning HTTP **503** from `GET /api/games?limit=30` reproduced a misleading silent failure. Global navigation/action results still appeared, but the palette did not distinguish a failed recent-games fetch from an account with no games, and offered no retry.

### Implementation

1. Added lightweight, independently accessible **loading**, **recent games unavailable**, and **no recent games yet** presentations below the searchable result list, without blocking navigation or other global commands. These states do not pretend an outage is an empty account.
2. The outage state has a visible **Retry recent games** button (minimum 44px target). The retry is disabled while fetching to avoid duplicate submissions; the rest of the palette remains usable.
3. Passed React Query's abort signal to the shared API request so discarded palette fetches can cancel on unmount, and rejected malformed successful responses instead of silently showing them as empty lists.
4. Localized all four recent-games status strings in English, German, Spanish, Russian and Bulgarian.
5. Extended `CommandPalette.actions.test.tsx` to verify loading, retryable errors, disabled busy retry, a confirmed empty result and preservation of Home navigation throughout.
6. Extended the real Chromium global-dialog fixture to fail the recent-games request, verify a named retryable alert and working Home option, recover the endpoint, and verify the distinctly labeled empty result with no overflow at 390px. Captured failure/empty screenshots and inspected the dark-theme failure screen.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **409/409 passed across 70 test files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including the new 503/retry/empty checks and all prior theme, accessibility, search, language and viewport checks.
- `git diff --check`: **passed**.
- Only shared palette/translation/test/progress files were modified. No live user data, other agent worktrees or feature-owned pages were changed, merged or deployed.

### Next high-impact audit

- Investigate palette recent-game **account isolation**. Its query key currently does not include the signed-in account, which may reuse cached game results after switching users in the same browser session. Reproduce with an isolated test before changing the shared cache key.

## 2026-11-12: Account isolation for private command-palette game search

### Verified failure

- Resumed from the clean pushed Agent B commit `07356f6` and investigated the exact pending cache-isolation concern without restarting previously finished UI investigations.
- A real Chromium session loaded a game against **FirstAccountOpponent**, then switched the authenticated Zustand user from account 1 to account 2 without reloading the page. **Before the fix, the old opponent remained visible in the command palette** instead of the second account's game. This was a genuine cross-account recent-game cache disclosure in the shared global search.

### Correction

1. Scoped the React Query key to `['palette-games', user?.id]` so every authenticated account receives independent cached recent-game results. Disabled requests when the palette is closed or the account is missing; retained abortable in-flight requests, existing loading/empty/error states, navigation and actions.
2. Extended the real Chromium fixture with user-specific game data and a direct account switch in the running SPA (not a browser reload). The test now verifies old account game results disappear and **SecondAccountOpponent** becomes visible.
3. Added a focused unit test checking the query key changes between two signed-in accounts and fetching is disabled while the palette is closed.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **410/410 passed across 70 test files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including the previously failing account-switch isolation check and all earlier 320/390/1440 modal checks.
- `git diff --check`: **passed**.
- Only the shared command palette, local Chromium/unit fixtures and durable progress report were edited. No real accounts, user data, other agent worktrees or production deployments were involved.

### Next investigation

- Inspect the shared shell's logout action feedback when the logout endpoint fails or authentication refresh remains unavailable. Confirm actual behavior with an isolated local fixture before touching the global logout flow.

## 2026-11-12: Confirmed logout, retryable errors and reliable global feedback

### Recovery and verified failure

- Recovered the exact clean pushed Agent B commit `b3714e1` and resumed the documented logout investigation, preserving earlier work and other agents' worktrees.
- In real Chromium, a **503** from `POST /api/auth/logout` previously closed the command palette with no explanation. The user was still signed in but received no failure feedback. Header and drawer logout buttons also had an unhandled rejected promise.
- The existing logout helper accepted any HTTP 200 payload, even `{ok:false}`, as success; server contract currently returns `{ok:true}` on confirmed logout.

### Implementation

1. Kept the command palette open during sign-out, using its existing accessible busy/error/duplicate-submission handling. Only closes on confirmation; rejected requests retain the option for immediate retry and never expose server error details.
2. Added shell-level busy/disabled and localized error feedback to desktop and mobile logout buttons. Failed requests keep the authenticated workspace visible; successful password-session logout refreshes auth and navigates to sign-in.
3. Validated `ok === true` in the shared logout helper before following an SSO provider logout URL or reporting local success. HTTP 200 with `ok:false` or a malformed response is treated as an error.
4. Added logout busy/error strings in all five locales. Enlarged the shell's transient alert close targets to 44x44px and confirmed no horizontal overflow in the 320px mobile shell.
5. Added targeted unit tests for failed/retried palette logout, failed/retried shell logout and unconfirmed HTTP 200; extended local Chromium shell and palette fixtures for HTTP 503, `ok:false`, and successful retry. Both dark/light/global navigation smoke tests remain in place.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **413/413 passed across 70 test files**.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** including desktop/320px mobile logout failure, alert dismissal, 44px close target and successful retry; visually inspected both error screenshots.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed** including failed/unconfirmed palette logout and successful retry, plus all existing palette tests.
- `git diff --check`: **passed**.
- Fixture endpoints only; no production sign-outs, user data changes, main merge, deployment or other agent worktree modifications.

### Next audit

- Evaluate the shared command palette's accessibility semantics for searching, moving through results and invoking commands by keyboard, especially the relationship between `aria-activedescendant`, displayed result IDs, and grouped results. Reproduce with actual keyboard and accessibility-tree browser checks before altering the shared palette.

## 2026-11-12: Keep keyboard selection valid as global search results change

### Reproduction

- Continued directly from clean, pushed Agent B `b7baf10` and followed the next documented palette accessibility audit; no earlier review, homepage or feature investigations were repeated.
- Real Chromium initially rendered three recently played account-specific games, selected the third via ArrowDown, and then changed the signed-in account within the running SPA. With only one new result, the search combobox **still referenced `patzer-palette-option-2`** although only option zero existed. This broke screen-reader active-descendant semantics and could make Enter activate nothing.

### Implementation

1. Derived a **bounded current selection index** from the actual filtered result count. The same index now drives `aria-activedescendant`, `aria-selected`, Enter invocation, ArrowUp/Down and scroll-into-view, preventing stale or negative indices when results shrink or briefly become empty.
2. Reset selection to the first item when account-specific games or the signed-in account change, without altering feature-owned keyboard interactions or global routing.
3. Extended the Chromium fixture to simulate three games in account 1 and one game in account 2, select the third, switch accounts without closing the palette and verify the active ARIA element exists. This check failed before the fix and passes afterward.
4. Added a unit test that changes available results without editing the search query and verifies the remaining option is selected and Enter opens its correct review URL.
5. Relaxed the browser harness's initial navigation timeout for cold Vite starts under concurrent build/test CPU load; the first concurrent attempt timed out during initial navigation, while the isolated final run passed.

### Validation

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **414/414 passed across 70 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including the previously failing account-switch active-descendant check, across all existing palette viewport and theme scenarios.
- `git diff --check`: **passed**.
- No feature-owned pages, production data, other agent worktrees, deployments or main merges were involved.

### Next audit

- Check the global palette's result options for efficient keyboard focus and screen-reader navigation when Tab traverses the dialog. It currently combines an `aria-activedescendant` combobox with focusable option buttons; validate whether Tab visits every result instead of the few actual dialog controls. Change only on verified user-facing friction.

## 2026-11-12: Consistent global palette Tab order

### Verified issue

- Continued from clean, pushed `bfe3264` and tested the exact pending shared-overlay keyboard-flow concern, without revisiting completed tasks.
- Real Chromium confirmed that after focusing Search and pressing Tab twice, focus moved into the first `role=option` button instead of wrapping to Search. The command palette had more than twenty independently tabbable result controls despite documenting the combobox's **Arrow-key + Enter** navigation model.

### Improvement

1. Set the palette's listbox option buttons to `tabIndex=-1`. This removes the excessive Tab stops while leaving options programmatically addressable through `aria-activedescendant`, selectable with Arrow keys and Enter, and clickable/touchable with a pointer.
2. Extended real Chromium tests at 1440px, 390px and 320px in light/dark themes: focus moves **Search → Close → Search**, while all existing keyboard result selection, mouse interactions, modal focus trapping and accessibility checks remain active.
3. Added a focused unit regression verifying all listbox options are excluded from the Tab order and an option still activates correctly on click.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **415/415 passed across 70 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed** including new Tab-order assertions, earlier account-switch keyboard assertions and all previous themes/viewports.
- `git diff --check`: **passed**.
- Changes were scoped to Agent B's shared palette/tests/progress; no feature-owned pages, production operations, merges or other agent worktrees were touched.

### Next audit

- Examine global keyboard shortcut discoverability outside the palette, including the shortcut help overlay and keyboard gestures on narrow tablet layouts. Investigate actual navigation confusion or focus collisions in Chromium before any changes.

## 2026-11-12: Global keyboard shortcuts safely transfer focus from mobile navigation

### Exact recovery and reproduced failures

- Resumed the clean, pushed Agent B commit `217e5dc` and the recorded narrow-tablet/shortcut audit. No earlier investigations or feature-owned pages were restarted.
- Real Chromium at **390x844** reproduced **two competing `aria-modal` dialogs** after pressing `?` with the mobile navigation drawer open. The App keyboard listener opened Shortcuts while the Layout-managed drawer remained visible. A hardware keyboard could also invoke `G+R` behind the drawer.
- The first fix closed the drawer before the new global overlay became interactive, but a second browser assertion revealed focus returning to **document.body** when Shortcuts was dismissed. The overlay had captured a soon-to-be-removed drawer button as its previous focused element.

### Implementation and verification

1. Added an explicit `globalOverlayOpen` signal from the shared App shell to Layout. A `useLayoutEffect` closes the mobile drawer when search/shortcut help opens, and hands return focus to the persistent **Open menu** trigger *before* the new modal captures the previous focus.
2. Guarded the App's `G+letter` quick navigation while the mobile drawer is modal; `?` and Ctrl/⌘+K still open the intended global overlay. No changes to chess move/Review or other feature-level keyboard behavior.
3. Extended the local Chromium fixture at **390x844** and **568x320** to verify `G+R` cannot route behind the drawer, `?` opens exactly one modal, Ctrl+K opens only the palette, both inputs/close buttons receive expected focus, and closing either restores focus to **Open menu**. Also verified tablet **768x900** help-to-palette switching without stacked dialogs.
4. Visually inspected 390px portrait and 568px landscape keyboard-help screenshots: only one dialog is visible, with the right close target focused and content scrollable on short screens.
5. Added a component regression test proving Layout dismisses the drawer, releases body scroll lock and restores the menu-trigger focus when the parent global-overlay state opens.

### Results

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **416/416 passed across 70 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed** after the negative control initially failed for stacked dialogs and subsequently for stale return focus.
- `git diff --check`: **passed**.
- Only shared App/Layout components, Agent B tests and progress log changed. No other agents' worktrees, merges, production data, deployments or live services were touched.

### Next audit

- Inspect whether global `G+letter` navigation can accidentally intercept browser/system shortcuts or activated controls when modifiers (Ctrl/Alt/Meta) are held. Verify actual behavior in a local browser before implementing any guard; keep the scope limited to shared App-level keyboard handling.

## 2026-11-12: Prevent global navigation sequences from hijacking browser keys

### Reproduction

- Continued from clean, pushed Agent B `988e80d`; resumed the exact outstanding shared keyboard-modifier audit.
- In real Chromium at **1024x768**, pressing `G` followed by **Ctrl+R** unexpectedly navigated to `/review` and prevented the normal browser refresh. A `G, X, R` sequence could also navigate despite the unrelated `X` because an unmatched key did not consume the waiting `G` prefix.

### Correction

1. In App-level global shortcuts, ignore Ctrl/Meta/Alt-modified keys (except the intentionally supported Ctrl/⌘+K palette shortcut). Modified combinations cancel any pending `G` prefix rather than being interpreted as routes.
2. Make the `G` prefix **one-shot**: the next non-G key consumes it, even if it is not a valid route. Opening a dialog or focusing a text field also clears the pending prefix.
3. Extended the real Chromium shortcut fixture with `G, Ctrl+R` (must not route), `G, X, R` (must not route), and positive `G, R` (must navigate to Review). The negative control failed before implementation and passed afterward.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **416/416 passed across 70 test files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including new modifier/one-shot cases and all earlier mobile/modal/contrast/accessibility cases.
- `git diff --check`: **passed**.
- No production, main, other agents' features or worktrees were modified. Only Agent B's App shortcut controller, Chromium fixture and this progress log changed.

### Next audit

- Inspect global shortcut help for parity with actual supported route combinations. The App router recognizes `G+S/O/N/L/U` in addition to the visible help rows, which may obscure discoverability. Confirm the help dialog and route map in-browser before altering the shared help content.

## 2026-11-12: Complete, navigable keyboard-shortcut help

### Reproduction

- Resumed clean pushed Agent B `34eb69b` and compared the global keyboard router's `G+letter` mapping to the live help dialog.
- Real Chromium negative control verified a genuine discoverability gap: the app supported `G S`, `G O`, `G N`, `G L` and `G U`, but **none were listed** in the keyboard help. The first missing key (`G S`) failed the browser assertion before implementation.

### Implementation

1. Added all five previously undocumented destinations (Settings, Openings, Improvement Plan, Lab and Players) to the shared shortcuts overlay. Existing documented routes, modal keys and Game Review help remain intact.
2. Grouped the overlay into **Global**, **Navigation** and **Game Review** sections to make eleven global navigation commands easier to scan. Section labels are real accessible headings, not decorative divs.
3. Added relevant translation keys in all five supported languages; also filled the existing missing Spanish/Bulgarian `Go to Learn` label rather than showing an untranslated key.
4. Extended local Chromium certification: all five missing shortcuts must appear with keyboard labels, all three section headings must be accessible, and the last newly added navigation command must be scrollable into view in **844x390** and **568x320** landscape.
5. Added `ShortcutsModal.routes.test.tsx` with full coverage for all eleven mapped global navigation sequences and closed-dialog behavior.
6. Inspected the 320px mobile, 568px landscape, and 1440px desktop screenshots; the new sections remain legible and longer lists scroll inside the dialog without horizontal overflow.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **418/418 passed across 71 test files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including the previously failing help-parity checks, keyboard focus and all previous responsive scenarios.
- `git diff --check`: **passed**.
- Scope restricted to Agent B's shared help modal, five locales, browser/unit regression tests and progress report. No other agents' pages, production systems, merges or deployment.

### Next audit

- Check touch-target sizing of shared shell controls in **640–1024px tablet layouts**. Some header actions adopt compact 36px controls from the `sm` breakpoint even when a tablet is touch-operated. Measure actual browser rectangles and available header width before changing component sizing.

## 2026-11-12: Tablet header touch targets without desktop density regression

### Recovery and measured defect

- Recovered clean, pushed `09f6477`, continuing the exact documented shared tablet touch-target audit.
- In real Chromium at **1024x768**, the header Search control measured **91×36px**; the `sm` breakpoint also made keyboard-help, profile, language and logout controls 36px tall or wide despite tablet touch input.
- The original 390/320 mobile checks already required 44px targets. The missing coverage was specifically the **640–1024px** intermediate layout.

### Implementation

1. Kept shared search, shortcuts, profile, language and logout header actions at **44px minimum in both dimensions** through tablet breakpoints; at `xl` desktop sizes, existing compact 36px sizing is retained to preserve information density.
2. Extended the local real-Chromium shell fixture at **640×900, 768×1024, 1024×768** in light and dark themes to assert visible header controls' actual bounding rectangles are at least 44×44px and to check existing no-overflow/route integrity behavior.
3. Inspected screenshot output at 640px, 768px and 1024px in light and dark modes. Controls remain readable, properly spaced, and do not overlap the heading or rail; layout transitions remain coherent.

### Verification

- `node web/src/components/navigation/capture-shell.mjs`: **passed** across the expanded responsive matrix, including touch target and overflow assertions.
- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **418/418 passed across 71 files**.
- `git diff --check`: **passed**.
- Only the shared Layout, Agent B browser fixture and progress report changed. No main merge, deployment, production data, or other agents' feature worktrees were touched.

### Next audit

- Check global header accessibility and discoverability across language changes and unusually long translated section headings on **640/768px tablet layouts**, including whether the title, search and settings controls remain identifiable without overlap. Reproduce with real localized browser screenshots before editing shared shell typography or breakpoints.

## 2026-11-12: Localized navigation integrity and readable rail labels

### Recovery and real-world evidence

- Continued from clean pushed `dfd4e68` and the exact pending 640/768px localized-header audit; kept the already verified touch-target changes intact.
- Measured real navigation strings in all five locales. At **768px**, the Spanish Learn page used English fallback `Learning` because `learn.nav` was missing. The equivalent Bulgarian translation was also absent. The real Chromium test failed before adding the missing Spanish label.
- Screenshot inspection exposed a second visual defect in the shared **80px rail**: Spanish `Estadísticas` and `Laboratorio` split their final letters onto a second line, despite other destinations fitting normally. The Spanish Review heading itself fit at 768px; no header typography change was necessary.

### Implementation

1. Added `learn.nav` to the Spanish and Bulgarian locale dictionaries (Aprender / Обучение), so the primary navigation and current-page title no longer fall back to English. Did not touch feature-owned Learn page content.
2. Made **better use of the existing rail width**: expanded each desktop navigation item's label area from 64px to 76px and reduced horizontal padding, while retaining the overall `w-20` app rail. Repositioned the active indicator to continue lining up with the rail edge.
3. Extended real Chromium shell tests for Spanish at **768px** and Bulgarian at **640px**, including translated Review titles without clipping, correct Learn navigation in the rail/mobile drawer, and no horizontal overflow. At the desktop-rail breakpoint, computed text measurements assert no whole-word label is wider than its available label area.
4. Added `Layout.locales.test.ts`, verifying all eleven global primary destination and settings labels are present and nonempty in **English, German, Spanish, Russian and Bulgarian**.
5. Visually rechecked Spanish 768px and Bulgarian 640px screenshots. The Spanish Statistics and Laboratory names now remain intact, and the active state is aligned and readable.

### Verification and ownership

- `node web/src/components/navigation/capture-shell.mjs`: **passed** after the earlier translation negative control, covering the existing responsive and newly localized checks.
- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **423/423 passed across 72 test files**.
- `git diff --check`: **passed**.
- Scoped to the shared Layout, translations and Agent B tests/progress. No user records, production operations, other agent worktrees, merges or deployment.

### Integration note / next audit

- The **Learn feature page** itself still displays some English strings when the surrounding shell is Spanish/Bulgarian; that content is owned by the Learn/Play lane and was intentionally left unchanged.
- Inspect the shared shell's **version/changelog labels** in non-English languages. The Bulgarian mobile-drawer screenshot still showed the English fallback `View changelog`; check all five locales and fix global shell language consistency where missing, not feature-owned pages.

## 2026-11-12: Changelog discoverability, localization and accessible version controls

### Exact recovery and confirmed problem

- Continued from clean, pushed Agent B `0763a64` and investigated the next documented shared-shell task; did not replay any completed navigation or feature work.
- Confirmed that Spanish and Bulgarian had no `common.viewChangelog` translation, causing an English fallback in the mobile navigation drawer. The rail's compact version button also exposed a hard-coded English-only accessible label and a much smaller hit target than the other tablet controls.
- Inspected the existing `ChangelogModal` and global drawer flow before editing. Confirmed the dialog's own loading/error/empty and focus-trap handling already worked; did not redesign or duplicate those patterns.

### Implementation

1. Added Spanish `Ver novedades` and Bulgarian `Виж промените` translations and localized the complete **version + changelog** accessible label in all five supported languages. Kept the numeric version visible and localized the associated tooltip and screen-reader name.
2. Increased the navigation-rail version button to a **minimum 44px height** with usable hover and focus styles, retaining the existing rail width and understated version-label appearance. The mobile drawer already had a 44px changelog row.
3. Expanded the five-language navigation translation regression to cover both `common.viewChangelog` and `navigation.versionChangelog` along with all global route labels.
4. Extended the real Chromium shell fixture to check the version-button touch target on tablet, the Spanish 768px rail and Bulgarian 640px mobile drawer translated labels, and the ability to open a single localized changelog dialog and close it. Focus must return to the original rail version button or the persistent mobile **Open menu** trigger, respectively.
5. Inspected the Bulgarian 640px screenshot; the drawer now shows **Patzer v7.19.0 · Виж промените**, not the English fallback.
6. Updated the old navigation unit-test i18n mock to interpolate `{{version}}` like the actual translation layer. A first full regression run exposed the outdated mock; focused retest after correction passed.

### Verification

- `npm run build -w web`: **passed**.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** with localized desktop/mobile changelog open-close and return-focus checks.
- `npx vitest run web/src/components/navigation/Layout.navigation.test.tsx web/src/components/navigation/Layout.locales.test.ts --maxWorkers=2`: **21/21 passed**.
- `npx vitest run web/src --maxWorkers=2`: **423/423 passed across 72 files**.
- `git diff --check`: **passed**.
- No merge, deployment, production operations, game data or other agent worktree modifications.

### Next audit

- Audit the shared `UpdateNotice` and changelog-related shell affordances in dark/light and localized mobile layouts, looking for real clipping, missing labels or intrusive focus changes. Prefer high-impact shared navigation issues, not feature-owned content.

## 2026-11-12: Prevent overlapping shell error alerts; confirm localized release notices

### Recovery and audit

- Continued from clean pushed Agent B `db8d7d8` and inspected the next documented shared-update-notice/changelog lane.
- The existing update banner and changelog **already handle** long content, touch targets, keyboard trapping, focus return, backend error and empty states without substantive product failures. The old Chromium notice fixture was expecting the pre-localization mobile version-button name, so its locator was updated to the new accessible label rather than weakening the new UX.
- Expanded the actual Chromium notice test to **320px Spanish and Bulgarian**. The full translated copy and linked release destination fit, the dismissal controls measured at least 44x44px, and no horizontal overflow occurred. Screenshot inspection confirmed the banner remains compact and readable in both languages. No speculative notice redesign was introduced.
- Auditing adjacent shared-shell error feedback identified a **real collision**: the independent language-save and logout error alerts were both positioned `fixed right-3 top-[4.25rem]`. Real Chromium reproduced both failures sequentially at 390px and measured both alerts at **exactly the same bounds** (`x=12, y=68, right=378, bottom=138`), so one obscured the other.

### Fix

1. Replaced the two independently fixed-position error overlays with **one bounded, scrollable, responsive notification stack** in the shared Layout. Both alerts retain their distinct `role=alert` semantics, localized messages, 44px dismiss targets and individual retry paths, while never occupying the same space.
2. Added a real Chromium 320px screenshot and no-overflow assertions after a failed language save followed by failed logout. Verified the two alerts do **not** intersect, closing the first preserves the second and closing both removes the empty feedback container.
3. Added a focused Layout unit test for two failures, proper shared containment and independent dismissal. Visually inspected the dark-theme 320px screenshot: both messages remain legible and their close controls accessible.
4. Updated the release/changelog browser fixture for the new localized version accessible name and added Spanish/Bulgarian update-banner regression checks.

### Verification

- `npm run build -w web`: **passed**.
- `npx vitest run web/src --maxWorkers=2`: **424/424 passed across 72 files**.
- `node web/src/components/navigation/capture-global-dialogs.mjs`: **passed**, including the pre-fix failure and corrected multi-alert test.
- `node web/src/components/navigation/capture-notices.mjs`: **passed** for prior release-note/error/dismissal checks and new localized mobile notices.
- Shared-shell responsive Chromium rerun is tracked with this batch.
- `git diff --check`: **passed**.
- No game data or production services, main merge, deployment, other agents' worktrees or feature-owned pages were changed.

### Next audit

- Inspect the shared shell's **update-notice contrast and focus accessibility** at narrow widths, plus banner behavior in reduced-motion and high-zoom conditions. Preserve its already healthy responsive layout; only fix genuine reproduced faults.

## 2026-11-12: Preserve keyboard focus after dismissing a release notice

### Reproduction

- Continued from clean pushed `7470f1f` and its exact next task, the global update-notice keyboard-accessibility audit.
- Real Chromium negative control: keyboard-focus the update notice's **Dismiss until the next release** button on desktop, press Enter, and observe that the notice disappears while `document.activeElement` falls back to **BODY**. This causes users to lose their keyboard position immediately after a routine shell interaction. The same issue could affect mobile hardware keyboard users.
- The existing release notice had already passed localized, dark/light, contrast/overflow, 44px touch-target, version-persistence, and changelog error/empty checks; no visual redesign was warranted.

### Scoped implementation

1. Added an optional `onKeyboardDismiss` callback to the shared `UpdateNotice`. The notice distinguishes keyboard/assistive activation using the click event's `detail === 0` and invokes that callback only for non-pointer dismissals.
2. The shared Layout provides a persistent search-trigger ref and transfers focus to Search before the notice unmounts. If a shell is rendered without global search, the existing main landmark is used as a fallback.
3. Pointer/touch dismissal continues to work normally without stealing focus; the existing per-version localStorage suppression behavior is unchanged.
4. Extended `capture-notices.mjs` with actual Enter-key dismissal and post-removal focus assertions on desktop **1440px** and mobile **320px**, including the notice for the next release.
5. Added `UpdateNotice.focus.test.tsx` with separate keyboard-versus-pointer behavior checks and the existing storage persistence assertion.

### Verification

- `npm run build -w web`: **passed**.
- `node web/src/components/navigation/capture-notices.mjs`: **passed**, including previously failing keyboard-focus restoration scenarios and earlier localized/empty/error/retry cases.
- Focused `npx vitest run web/src/components/UpdateNotice.focus.test.tsx`: **2/2 passed**.
- `npx vitest run web/src --maxWorkers=2`: **426/426 passed across 73 test files**.
- `git diff --check`: **passed**.
- No change to feature-owned pages, production services or game records. No merge, deployment or other agent worktree modification.

### Next audit

- Investigate keyboard navigation of the release notice's **What's new** link and dismissal control when the notice is combined with a global modal or an unusually tall translated notice. Avoid expanding global UI chrome without a reproduced need.

## 2026-11-12: Release-notice keyboard audit and first-run homepage identity

### Recovery and negative controls

- Recovered the clean, pushed Agent B branch at `d670cdc`, verified independent worktrees and resumed the precise pending update-notice keyboard-navigation audit instead of repeating prior work.
- Expanded actual Chromium checks for the release notice's **What's new → Dismiss → What's new** Tab order at **1440, 390 and 320px**, both light and dark modes. Opening global Shortcuts (`?`) and Search (`Ctrl+K`) from the notice link kept just one active dialog, trapped Tab inside it and returned focus to the same link after Escape. All checks **passed before any change** to the notice itself; no unnecessary redesign.
- Audited the shared homepage next. Chromium negative control found a blank square in the greeting hero for profiles with an empty avatar emoji. The profile fixture legitimately supplies `avatar_emoji: ''`, but the Home `??` fallback treated that empty string as meaningful. The hero also rendered 40px-tall Play and 32px-tall Game Review links, both undersized as touch targets.

### Scoped correction

1. The Home greeting now uses a visible chess-piece avatar when the profile emoji is empty/whitespace, and falls back from empty/whitespace display names to the existing username (then the app name if required). This preserves personalization without an empty first impression.
2. Both main hero actions use a **44px minimum height** and restrained, visible keyboard focus states. Reduced-motion users retain immediate interactions without unnecessary transitions.
3. Extended the existing real Chromium responsive-shell fixture to assert hero identity and both touch-target bounding rectangles, across the full **1920/1440/1024/768/640/390/320** matrix in light/dark modes. Added a whitespace-only profile regression at 390px and inspected its screenshot alongside 320px/1440px presentation.
4. Added an isolated homepage unit regression for the missing display name and emoji, and the two guaranteed hero touch-target classes. Previous Home stats/error/learning coverage remains intact.

### Verification

- `node web/src/components/navigation/capture-notices.mjs`: **passed** all original release-notice/changelog, localization, and new banner+overlay keyboard checks.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** after the original negative control reported blank avatar and undersized hero actions.
- `npx vitest run web/src --maxWorkers=2`: **427/427 passed across 73 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No change to game review, library, imports, play internals, production operations or other agent worktrees.

### Next audit

- Verify first-run home activity tiles and recent-game links at **320px** under keyboard/touch input. The banner and hero are stable; look for a genuine focus or tap-target problem in the first navigation journey, without rebuilding already-polished cards.

## 2026-11-12: Make returning-player recent-game navigation touch-friendly

### Reproduction

- Continued from clean, pushed `d2e8c57`, finishing the next documented narrow-mobile Home navigation audit rather than revisiting completed homepage, command palette or feature work.
- The shared shell's activity cards already inherit the global visible keyboard focus ring and have large clickable surfaces. A returning-player recent-games fixture at **320x700px** exposed the real gap: the `View all →` heading link had a **58×16px** hit area, while the individual game-row link already met 44px sizing. The real Chromium negative control failed specifically on `View all`.

### Implementation and verification

1. Enlarged only Home's recent-games `View all` navigation link to a **minimum 44×44px target**, using inline-flex alignment, subtle hover background and the existing scoped keyboard-focus ring tokens. Its label remains compact instead of becoming a new large button.
2. Extended `capture-shell.mjs` with a returning-player fixture including an actual recent game and consistent one-game stats; checked `View all` and game-row hit rectangles, no 320px horizontal overflow and captured `home-recent-games-mobile-320.png`. Chromium passed after the fix, and the screenshot shows a balanced header and legible row.
3. Added an isolated Home regression verifying the `View all` target class/destination and that the returning player's latest game opens its correct `/review/:id` route.
4. Kept Game Review, Games Library, imports, and game-record handling strictly outside this lane.

### Results

- `node web/src/components/navigation/capture-shell.mjs`: **passed** the previous 1920/1440/1024/768/640/390/320px, dark/light, and new returning-game mobile assertions.
- `npx vitest run web/src --maxWorkers=2`: **428/428 passed across 73 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No production operations, main merge, other agent worktrees or feature-owned page edits.

### Next audit

- Inspect first-run and returning-player Home controls in **German and Spanish at 320px** for long translated strings that may shrink effective touch targets or clip adjacent actions. Verify the actual rendered localized paths and light/dark focus behavior before changing shared layout or translations.

## 2026-11-12: Reliable touch-sized homepage recovery after API outages

### Actual-browser reproduction

- Resumed from clean pushed `211ecea` and extended the existing Home interaction audit to real API failure states rather than repeating completed healthy-data or recent-games tests.
- With local-only HTTP **503** fixtures for stats, recent games, plan and achievements at **320×700px**, Chromium measured the four visible homepage Retry controls as **64×34px**, **70×38px**, **50×24px** and **50×24px**. All were too short for a reliable touch target; the tiny plan/achievement links were especially hard to recover with.

### Scoped fix

1. Applied consistent **44px minimum height/width** to the stats error Retry, recent-games Retry, and reusable Home activity-status Retry controls. The latter covers plan, achievements, learn progress and daily puzzle, without changing global CSS or other agents' feature-owned buttons.
2. Kept each action's original localized text, accessible label, retry callback and error-state distinction. Added an understated hover treatment to the small activity retry controls; existing accessible focus indicators remain active.
3. Extended Chromium's existing Home fixture with the four actual 503 responses, awaited recoverable error states, checked all visible `main button` bounding rectangles and no overflow at 320px, and captured `home-error-recovery-mobile-320.png` for visual inspection. The test failed before the fix and passed afterward.
4. Strengthened Home unit tests to check the hero and activity error recovery targets and added a new recent-games error/retry test validating the click still recovers to the empty-account guidance after the endpoint succeeds.

### Verification

- `node web/src/components/navigation/capture-shell.mjs`: **passed** the failure-recovery fixture and all existing responsive, localized navigation, dark/light and first-use cases.
- `npx vitest run web/src --maxWorkers=2`: **429/429 passed across 73 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- Changes limited to Home, Agent B's browser/unit tests and this progress report. No merge, deployment, production data, Game Review/Library or other agent worktree changes.

### Next highest-impact audit

- Check the **320px localized homepage first-run/error paths** in German and Spanish, especially long retry messages and whether the two main CTAs stay discoverable and fully within the hero. Then audit the shared homepage fallback when a profile lacks a username, ensuring no regressions from the new first-use identity logic.

## 2026-11-12: Complete shared Home localization across loading, first-use and outages

### Recovered state and reproduced problem

- Recovered clean pushed Agent B `660f4b3`; followed the recorded German/Spanish 320px Home audit without reopening completed navigation, import, coach or play work.
- Static locale inspection found that **all five languages lacked** `home.continue`, Home loading/error strings and `common.retry`; Spanish and Bulgarian additionally lacked the time-of-day greeting and some Home learning/recent-game labels. This exposed English fallback strings inside otherwise translated layouts.
- In real Chromium, the German first-use homepage initially failed the new assertion requiring the localized **Continue improving** heading. The initial greeting assertion was corrected for CSS uppercase presentation before the genuine fallback was confirmed.

### Changes and coverage

1. Completed shared Home loading, outage and continuation messages and `common.retry` across English, German, Spanish, Russian and Bulgarian. Added missing Spanish/Bulgarian greetings, chess streak labels, recent-game status and Home learning-tile navigation strings. Kept feature-owned Learn lesson content unchanged.
2. Extended `capture-shell.mjs` with real **320x700px** German and Spanish first-use and HTTP 503 outage flows. Checked native localized greetings, section headings, recovery messages, Retry labels, Play/Review target dimensions, horizontal overflow and screenshots. Both localized flows now pass; screenshots remain readable and actions fit within the hero.
3. Added `Home.locales.test.ts` to require the shared homepage's essential greeting/recovery/learning navigation keys and localized Retry actions in all five supported languages.
4. Confirmed in Chromium that a first-use account with no display name **and no username** already renders the existing Patzer fallback visibly; no speculative identity rewrite was needed.

### Verification

- `node web/src/components/navigation/capture-shell.mjs`: **passed** the full existing responsive/theme matrix, localized first-use/outage screens and missing-username fallback.
- `npx vitest run web/src --maxWorkers=2`: **434/434 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- All changes limited to shared locale dictionaries and Agent B browser/unit tests; no production data, deployment, merge or interference with other agents' worktrees.

### Next audit

- Audit the **returning-player Home recent-game result glyphs** under a screen reader and keyboard. The list currently renders W/L/D letters without explanatory accessible names; verify actual link names with Chromium and fix only if they fail to communicate win/loss/draw outcomes.

## 2026-11-12: Make recent-game results understandable to screen readers

### Verified failure

- Recovered clean, pushed Agent B `bc122cb`, then audited the Home recent-game links as documented, without altering Game Review/Library internals or replaying previous audits.
- Real Chromium at **320×700px** confirmed that the visual `W` status badge had **no accessible Win graphic/name** inside the game link. Equivalent L/D letters and the in-progress bullet lacked reliably announced outcome meanings.

### Scoped fix

1. Kept the existing compact W/L/D/bullet visuals, colors and row dimensions, but assigned each result badge `role=img` with an explicit, localized accessible label and matching hover title. A screen reader now announces **Win / Loss / Draw / In progress** rather than isolated letters or an unexplained dot.
2. Added Home-specific win/loss/draw names in all five supported locale dictionaries (English, German, Spanish, Russian, Bulgarian); the existing translated `review.inProgress` label remains the source for ongoing games.
3. Added four Home unit regressions checking each actual badge's accessible name, visible symbol and title, plus locale coverage for the new result labels.
4. Extended the real Chromium returning-player fixture through win, loss, draw, ongoing and Spanish victory cases. Verified that both the nested result graphic and containing `/review/:id` link expose the expected spoken outcome. The Win negative control failed before the implementation and passed afterward.

### Verification

- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including the new outcome accessibility matrix and earlier responsive/localized/error scenarios.
- `npx vitest run web/src --maxWorkers=2`: **438/438 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No main merge, deployment, production-game changes or other agent worktree modifications.

### Next audit

- In the **320px returning-player recent-game row**, check whether the player's own name pushes the opponent completely out of view. If verified, prioritize the opponent identifier on narrow screens while retaining full white-vs-black names on larger screens and preserving accessibility.

## 2026-11-12: Keep opponents identifiable in narrow Home recent-game rows

### Verified issue and unfinished-work recovery

- Recovered the three uncommitted files on `agent/patzer-design-system-shell-20261112` at `68920cd` without discarding or replaying completed work.
- Pre-fix Chromium measured just **18.5px** of visible opponent name at **320px**: the repeated account-owner name pushed the opponent out of view.
- The initial unfinished improvement solved the ordering, but its saved screenshot placed `vs` alone on the first line. New 390px screenshots exposed a second layout defect: the single-letter tail of a long opponent name wrapped because the right-aligned `Unreviewed` label competed for width.

### Implementation

1. Narrow rows prioritize the opponent in both White and Black games and clamp the opponent name at two lines, beside—not below—the localized `vs` prefix.
2. On small screens, `Unreviewed` moves into the secondary game metadata instead of consuming the opponent's name area. On `sm`+ screens the original full White-versus-Black matchup and right-aligned status remain intact.
3. Preserve game destinations, accessible localized W/L/D/ongoing outcome glyphs, dates and time controls.
4. Extend unit tests for both player colors and correct game links; extend the actual Chromium responsive fixture to inspect light/dark modes, White/Black games, no horizontal overflow and opponent text at **320, 390, 768, 1440px**.

### Verification and evidence

- `node web/src/components/navigation/capture-shell.mjs`: **passed** after final layout adjustment, including the full prior responsive, localization, keyboard and error-state fixture plus the new opponent-specific matrix.
- `npx vitest run web/src --maxWorkers=2`: **439/439 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- Inspected `artifacts/agent-02/home-recent-light-white-320.png`, `home-recent-dark-white-320.png`, `home-recent-light-black-390.png` and `home-recent-dark-black-768.png`. The final 390px screenshot fits the complete opponent name on one line and puts `Unreviewed` below it.
- Scope limited to Home and its unit/browser tests; no deployment, main merge, production data change, or interference with feature agents.

### Next audit

- Investigate extremely long, unbroken player names and translated status text at **320px** to confirm the responsive opponent presentation remains legible, then audit first-use Home navigation accessibility or onboarding if the row is sound. Require Chromium reproduction before making further changes.

## 2026-11-12: Protect opponent visibility for long usernames on tablets

### Independent follow-up audit and negative control

- Resumed from clean, pushed `a96ca2e`. A separate ignored Playwright edge-case audit verified the 320px presentation stays within the viewport for an unusually long, unbroken opponent name in English, German and Bulgarian, across light/dark themes.
- The same audit **reproduced a substantive tablet regression** in the retained desktop-style White-vs-Black line: a 44-character owner username left **0px** of the opponent visible at **640px**, and only **35.2px** visible at **768px**, in both themes. Captured and inspected `artifacts/agent-02/audit-long-owner-tablet-640.png`.
- Root cause: the whole desktop matchup was one `truncate` line, so the repeated owner name consumed the line before the opponent. The mobile-only fix did not apply at Tailwind's `sm` breakpoint.

### Scoped implementation

1. Present the larger-screen matchup as a flex row containing separately truncated White and Black names with a fixed `vs` separator.
2. Limit the signed-in player's name to at most 40% of the available matchup width, reserving the remaining space for the opponent regardless of whether they played White or Black. Normal-length names remain fully visible; both full names remain accessible to assistive technology and via native title tooltips.
3. Add explicit opponent/matchup fixture markers and strengthen the local Chromium test with long-owner German cases at **640 and 768px**, in both player colors and light/dark themes, verifying at least **100px** of visible opponent text and no page overflow. Preserve existing mobile and desktop behavior.
4. Extend Home component tests for the responsive desktop opponent mapping and available-width classes.

### Verification

- Negative-control audit: opponent visibility **0px at 640px**, **35.2px at 768px** before fix.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including new German long-owner tablet matrix, original responsive modes, localization, accessibility and outage assertions.
- `npx vitest run web/src/pages/Home.stats.test.tsx --maxWorkers=2`: **12/12 passed**.
- `npx vitest run web/src --maxWorkers=2`: **439/439 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- Inspected final `home-recent-long-owner-light-white-640.png`, `home-recent-long-owner-light-black-640.png`, `home-recent-long-owner-dark-white-768.png`; both player names and the review status are readable and correctly ordered.
- No other agent-owned pages or worktrees, production environment, deployment, or main merge touched.

### Next audit

- Audit Home's actual keyboard traversal from the hero through Recent Games at narrow and desktop widths, especially the discoverability and focus state of the individual recent-game link; only change code if Chromium demonstrates an interaction or visibility problem. Alternatively, investigate homepage data-state clarity for a returning player if keyboard behavior is sound.

## 2026-11-12: Restore visible keyboard focus to Recent Games rows

### Reproduction in actual Chromium

- Continued from clean pushed `5038b88` and audited the next recorded Home keyboard-usage issue, without reworking the shared shell's already-correct focus rules.
- At **320px** and **1440px** in dark mode, repeated real Tab presses focused the `/review/103` game link. Chromium confirmed `:focus-visible` and a **3px** computed focus outline, yet the screenshots showed **no visible indicator** around the row.
- Root cause: the row sits flush against the rounded list's `overflow-hidden` boundary (only a 1px inset on all sides), which clips the global 3px outline and 3px outline offset. Pre-fix computed `boxShadow` was `none`; the visually focused link looked identical to an unfocused row.

### Scoped solution

1. Give only the Home Recent Games row links a **2px inset focus-visible ring** using the shared `ui-focus` color, visible inside the rounded clipping parent without changing list geometry.
2. Keep the global outline rule, normal hover state, click navigation, aria name, result badge and touch sizing unchanged.
3. Strengthen the Home unit test for inset-ring classes and the persistent real Chromium fixture to navigate by Tab and require a `:focus-visible` inset shadow, at **320 and 1440px**, in both light and dark themes.

### Verification

- Negative-control Chromium screenshots: `artifacts/agent-02/audit-home-row-focus-320.png` and `audit-home-row-focus-1440.png` showed no visible focus cue despite correctly focused game links.
- Targeted post-fix Chromium checked keyboard focus plus computed **inset 2px shadow** and the screenshots showed a clear blue ring in both sizes.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including full prior responsive/theme/localization coverage and the added four keyboard-focus cases; screenshots `home-recent-focus-{light,dark}-{320,1440}.png`.
- `npx vitest run web/src --maxWorkers=2`: **439/439 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- Only the Home component, its tests and this progress report changed; no main merge, deployment, production data, or other-agent worktrees touched.

### Next audit

- Check computed text contrast for the **Unreviewed** status and Recent Games metadata across light/dark themes, particularly its 11px uppercase presentation, because the dark-mode screenshots show a faint secondary label. Reproduce and measure before changing semantic color tokens.

## 2026-11-12: Make the Home Unreviewed status meet text contrast standards

### Reproduction

- Continued from clean pushed `e7823dd` and measured real Chromium computed foreground/background colors rather than inferring contrast from screenshots.
- Desktop/tablet `Unreviewed` used fixed `text-chesscom-400` RGB(125,118,112), giving only **4.47:1** on the light card and **3.02:1** on the dark card. Its compact 11px uppercase lettering requires at least **4.5:1** for normal text.
- The mobile row already used the accessible `text-ui-mutedText` color via its metadata parent: **6.21:1 light** and **8.17:1 dark**, so no mobile change was needed.

### Fix and verification

1. Switch the single desktop `Unreviewed` label to the shared `text-ui-mutedText` semantic color; retain its 11px uppercase typography, alignment and responsive placement.
2. Add a Home component-class regression and a real Chromium computed-color assertion requiring **at least 4.5:1** for the visible desktop status in the existing 768/1440px, both-theme and both-player-color matrix.
3. Separate post-fix Chromium contrast probe measured **6.21:1 light** and **8.17:1 dark**, with unchanged mobile values.
4. Inspected `artifacts/agent-02/home-recent-dark-white-1440.png`; secondary status remains visually subordinate but clearly legible.
5. `node web/src/components/navigation/capture-shell.mjs`: **passed**, including prior keyboard, responsive, long-name and translation checks.
6. `npx vitest run web/src/pages/Home.stats.test.tsx --maxWorkers=2`: **12/12 passed**; `npx vitest run web/src --maxWorkers=2`: **439/439 passed across 74 files**.
7. `npm run build -w web`: **passed**; `git diff --check`: **passed**.
- Scope limited to Home and its browser/component tests plus this report. No merge, production change, deployment, or edits to other agents' lanes.

### Next audit

- Measure contrast and visual affordance of **Win/Loss/Draw** glyphs in Home Recent Games across both themes and at 320/1440px. Their accessible outcome names were already corrected in an earlier commit; do not repeat that work. Fix only a demonstrated, meaningful visual accessibility problem.

## 2026-11-12: Restore legible Recent Games result glyphs in both themes

### Measured issue

- Continued from clean pushed `f2faa64` and directly measured Chromium's computed glyph foreground and **alpha-composited badge background**, not the surrounding row.
- At 320px and 1440px, Win measured **2.88:1 light / 3.28:1 dark** and Loss **2.94:1 light / 3.24:1 dark**. Draw and In progress measured **5.73:1 light / 4.24:1 dark**. These small symbols all require at least **4.5:1**.
- Existing localized `role=img` outcome names, compact colored badge backgrounds, dimensions, semantics, and link navigation were already correct and remain untouched.

### Scoped implementation

1. Win and Loss glyphs now use existing semantic `text-ui-success` and `text-ui-danger` tokens, which adapt to light and dark themes without mutating global style variables or removing their established green/red backgrounds.
2. Draw and In progress retain their neutral badge backgrounds and light-theme text, but use `dark:text-ui-mutedText` so small letters remain readable on dark cards.
3. Extend Home unit regression coverage for all four expected classes while retaining the outcome accessible names.
4. Add an isolated Chromium result-glyph contrast helper and a full **Win/Loss/Draw/In progress × light/dark × 320/1440px** matrix to the existing shell fixture. It computes foreground-to-composited-badge contrast and rejects any value below **4.5:1**.

### Verification

- Post-fix Chromium measurements: **Win 5.93:1 light / 6.63:1 dark; Loss 5.25:1 in both themes; Draw and In progress 5.73:1 light / 7.15:1 dark**.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including all previous theme, width, accessibility, keyboard, localization, outage and long-name cases.
- `npx vitest run web/src --maxWorkers=2`: **439/439 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- Inspected actual Chromium `artifacts/agent-02/home-result-light-win-320.png` and `home-result-dark-loss-320.png`; semantic color meanings remain distinct and the glyphs are visibly readable.
- No changes to main, production, deployment, other agents' worktrees or feature-owned pages.

### Next audit

- Audit Recent Games' **analyzed accuracy values and game metadata** under light/dark at 320/390/768, particularly if analyzed accuracy has low contrast or becomes illegible due to the right-hand accuracy column. Move on to a higher-impact shell/onboarding issue if those states pass; do not repeat completed status/glyph audits.

## 2026-11-12: Keep analyzed-game opponents readable and clarify accuracy ownership

### Independent Chromium reproduction

- Recovered clean pushed `8a58f3f` and audited *analyzed* Recent Games, which had not been covered by the earlier unreviewed-row improvements. Used the actual Home page with local API fixtures containing 99.9% White / 100.0% Black accuracies and an unusually long account name.
- At **320px**, the right-hand two-score column consumed **92px**, reducing the opponent-name container to only **107px**. At 390px it was still just 177px. The two unlabeled percentages were especially ambiguous on phones, where the White-versus-Black names are intentionally hidden.
- The score separator used fixed low-contrast `text-chesscom-400`, measured at **4.47:1 in light mode** and **3.02:1 in dark mode**. The primary and secondary score digits themselves already met contrast requirements.
- Captured and inspected `artifacts/agent-02/analyzed-light-white-320.png`, `analyzed-light-white-390.png`, `analyzed-light-white-640.png`, and `analyzed-dark-black-320.png` as negative-control screenshots.

### Scoped fix

1. Show the actual opponent name at full available row width on phones instead of reserving a fixed right-hand column for two accuracy values. Present both percentages in their own compact, wrapping line below date/time.
2. Explicitly label mobile accuracies as **You** and **Opponent**, selecting the correct White/Black score depending on the signed-in player's color. Reuse the existing localized `players.you` key; add the minimal `home.opponent` label to all five supported languages.
3. Preserve the established White/Black percentages in the right-hand column at tablet/desktop widths, but switch the slash to the accessible `text-ui-mutedText` token.
4. Extend Home unit coverage with both player colors and correct score ownership; extend five-language Home dictionary coverage.
5. Add a durable Chromium regression for analyzed games at **320, 390, 768 and 1440px** in both themes and player colors, with an exceptionally long owner username. Assert mobile name width, both explicit score labels and values, absence of redundant desktop scores, no horizontal overflow, and desktop score/separator contrast. Check German mobile labels separately.

### Verification

- The real Chromium responsive shell fixture **passed**, including the new analyzed-game matrix and existing keyboard, translations, result, contrast, long-name and outage checks.
- `npx vitest run web/src/pages/Home.stats.test.tsx web/src/pages/Home.locales.test.ts --maxWorkers=2`: **19/19 passed**.
- `npx vitest run web/src --maxWorkers=2`: **441/441 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- Inspected final `artifacts/agent-02/home-analyzed-light-white-320.png`, `home-analyzed-dark-black-320.png`, `home-analyzed-light-white-390.png`, and `home-analyzed-dark-black-768.png`: the full `OpponentWithALongName` identifier stays legible and the separate score line shows correct ownership. Desktop ordering and game destinations are preserved.
- No merge, deployment, production data or other-agent-owned feature changes.

### Next audit

- Examine the first-use Home hero with a *very long display name* and with increased system text size at 320px. Verify whether the greeting, action labels and player identity remain readable and the Play/Review actions retain 44px targets. Do not change otherwise-stable onboarding without an actual browser reproduction.

## 2026-11-12: Keep long first-use identities readable at mobile sizes and enlarged text

### Independent reproduction and cause

- Continued from clean pushed `aa4e2d8`, checked Home's first-use hero in Chromium with a 65-character unbroken display name, 320/390/768px viewports, light/dark themes and root font sizes of 16px, 20px and 24px.
- **Before:** the avatar and name shared a single narrow flex row, and the heading used a single-line ellipsis. At 320px/16px the name's visible area was just 192px, showing roughly `GrandmasterC…`; at 320px/24px it shrank to 128px and showed only `Gran…`. The full name was present semantically, but not discoverable visually.
- **After first adjustment:** a separate full-width, two-line heading made more of the name legible while keeping the avatar and greeting. The extended browser fixture then **caught a separate genuine 2px horizontal overflow at 320px/24px** (`document.body.scrollWidth = 322`). The source was the Home activity-card grid's implicit `auto` minimum column, not the hero. An explicit shrinkable `grid-cols-1 min-w-0` column removed this overflow without changing card content.

### Scoped implementation

1. Replace the narrow identity flex row with a small grid: avatar and greeting share the first line on phones, while the heading gets the full second line; at `sm`+ the avatar spans both rows and the heading stays in the second column.
2. Use a maximum of two breakable lines for the display name (rather than a hard one-line truncation), and preserve its complete value in the heading text and native title for hover.
3. Give Continue Improving's activity grid an explicit shrinkable single-column mobile layout so enlarged browser text cannot stretch it beyond a 320px viewport.
4. Update Home identity unit coverage and browser fixture's avatar lookup to match the new structure. Add a durable Chromium matrix for long names across **320, 390 and 768px**, **both themes**, and **100% and 150% root text sizes**, asserting the heading's two-line clamp, no overflow, full accessible title, and Play/Review links at least 44px and inside the hero.

### Evidence and verification

- Negative control: `artifacts/agent-02/audit-home-hero-long-320-16.png` and `audit-home-hero-long-320-24.png` demonstrated single-line identity loss.
- Explicit overflow negative control: **322px body scroll width at a 320px viewport** after the initial hero change, with activity cards exceeding the right edge. Post-fix Chromium measured **320px** body width and no out-of-viewport descendants in both themes.
- Inspected post-fix screenshots `home-long-identity-dark-320-font24.png` and normal `light-320x700.png`; full avatar, more meaningful first two name lines, usable Play and Game Review buttons, and stable first-use card hierarchy.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including prior responsive, localization, keyboard, recent-game, error-recovery and contrast cases.
- `npx vitest run web/src/pages/Home.stats.test.tsx --maxWorkers=2`: **15/15 passed**.
- `npx vitest run web/src --maxWorkers=2`: **442/442 passed across 74 files**.
- `npm run build -w web`: **passed** (TypeScript and Vite production bundle).
- `git diff --check`: **passed**.
- No changes to feature agents' worktrees, main, deployment or production data.

### Next audit

- Investigate **first-use onboarding links and their focus treatment** at 320px, especially at enlarged font sizes: the four learning/activity tiles may contain clipped focus rings or unreadable shortcut labels. Reproduce the actual problem using keyboard + Chromium before editing. Do not repeat completed hero or recent-game audits.

## 2026-11-12: Honor the selected language for Home recent-game dates

### Independent audit

- Resumed from clean pushed `2b99ed0`; verified first-use keyboard focus with actual Tab navigation in Chromium at **320, 390 and 1440px**, normal and enlarged text, both themes. Hero, onboarding and activity links all retained visible focus and no horizontal overflow, so no focus-style change was needed.
- Investigated the apparent first-use "all puzzles completed" copy. The local fixture returned a null puzzle, but the actual server's `dailyPuzzle()` contract returns null only after the user has exhausted the available pool. The production message is consistent with the contract; **no gratuitous copy change**.
- The next real issue was in Home Recent Games localization. With the user profile in **German**, the heading correctly read "Letzte Partien" but the date still read **11/12/2026**, matching Chromium's English browser locale. German users expect **12.11.2026**. Root cause: `toLocaleDateString()` omitted the selected `i18n.language` argument, unlike existing account-aware date display elsewhere in Patzer.

### Fix

1. Explicitly format Home's game date using `i18n.language` provided by `useTranslation()`, rather than relying on the browser's default locale. Retain the original timestamp, existing in-progress fallback and game navigation.
2. Add a stable `data-home-recent-date` marker to unambiguously identify the date, separate from nested metadata/accuracy labels. The first new Chromium assertion caught a selector ambiguity between metadata and mobile accuracy, which the dedicated marker resolves.
3. Extend Home component tests to assert the actual localized date value across **English, German, Spanish, Russian and Bulgarian**.
4. Extend the full real-Chromium shell fixture across all **five languages at 320px** and German at **1440px**, checking the selected interface language's date rather than the browser default, no overflow and captured screenshot evidence.

### Verification

- Negative control: Chromium browser locale `en-US`; German selected, yet Home originally showed **11/12/2026**.
- Final Chromium: English **11/12/2026**, German **12.11.2026**, Spanish **12/11/2026**, Russian **12.11.2026**, Bulgarian **12.11.2026 г.**. The 320px/desktop German screenshots show the correct date without layout changes: `artifacts/agent-02/home-recent-date-en-320.png`, `home-recent-date-de-320.png`, `home-recent-date-de-1440.png`.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** including full prior responsive/keyboard/localization/error-recovery coverage and the new date matrix.
- `npx vitest run web/src/pages/Home.stats.test.tsx --maxWorkers=2`: **20/20 passed**.
- `npx vitest run web/src --maxWorkers=2`: **447/447 passed across 74 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- Scope limited to Home and its local/browser regression tests, plus this progress entry; no other agents' feature pages, worktrees, main, deployment or production data changed.

### Next audit

- Verify the **HTML document language** when the user selects a language other than English. Chromium currently reports `document.documentElement.lang === 'en'` while rendering German UI text; if confirmed, screen readers may pronounce the interface using the wrong language. Fix the global language synchronization once, for all authenticated and unauthenticated screens, with targeted DOM/Chromium evidence.

## 2026-11-12: Synchronize HTML language with Patzer's five interface languages

### Reproduction and root cause

- Continued from clean pushed `d7e9365` without re-running completed date investigations.
- Chromium had shown a German-language Home heading (`Letzte Partien`) with `document.documentElement.lang === 'en'` and browser locale `en-US`. This signals English speech rules to screen readers even though navigation and page content are German.
- `web/index.html` intentionally starts with `lang="en"`, but the shared `web/src/i18n.ts` initialization did not update the document language after detecting a stored setting or processing a profile/settings language change. There was no existing `document.documentElement.lang` sync in the app.

### Scoped implementation

1. Register a **single global i18next `languageChanged` handler before initialization** in `web/src/i18n.ts`. Set `document.documentElement.lang` to the supported, normalized language code, with a document-presence guard for test/server environments.
2. No route-specific language handling, translation text, visual styles or feature-agent pages changed. The listener covers **initial detection from localStorage and runtime changes**, including public login/setup and signed-in profile language updates.
3. Add `web/src/i18n.documentLanguage.test.ts` with five supported language cases and a switch-back-to-English regression.
4. Strengthen the existing Chromium shell fixture's multi-language Home, date and navigation checks to fail when visible language disagrees with the actual document `lang` attribute.

### Verification

- Focused `npx vitest run web/src/i18n.documentLanguage.test.ts --maxWorkers=2`: **6/6 passed**.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including responsive, focus, Home date and translated navigation regressions and the new HTML-language assertions.
- Independent Chromium **unauthenticated** `/login` probe with browser locale `en-US` and stored language preferences `en/de/es/ru/bg`: for every preference, document `lang` matched the selected language; observed German sign-in content in `artifacts/agent-02/guest-login-language-de.png`.
- `npx vitest run web/src --maxWorkers=2`: **453/453 passed across 75 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No changes to main, production data, deployment or other agents' worktrees.

### Next audit

- Audit the **public sign-in / setup language selector** at 320px and enlarged text for touch accessibility. The selector appears as five compact two-letter controls, and actual hit rectangles may fall short of the 44px target; measure in Chromium and fix within the global authentication shell only if confirmed. Include keyboard selection and all themes.

## 2026-11-12: Increase public language-switch touch targets without breaking keyboard use

### Verified defect and cause

- Resumed from clean pushed `2b0b685`. Independent Chromium measurements of public `/login` found **all five language buttons only 40×36px** at default font size in both themes, at **320, 390 and 1440px**. This falls below the 44×44px touch target established for Patzer's other interactive shell controls.
- The already-existing admin Setup language buttons use `min-h-11`; they did not need modification. The shared `AuthShell` (also used for signup and account recovery) still specified `min-h-9 min-w-10`.

### Implementation

1. Set `min-h-11 min-w-11` on the five shared public AuthShell language buttons, preserving their original compact appearance, native-language accessible names, pressed state, focus ring and onClick language switching.
2. Extend Login unit tests to assert all five available, labeled controls have the expected minimum-size classes and selecting German updates both `aria-pressed` and the document `lang` attribute.
3. Extend the actual Chromium shell fixture after the mobile logout journey to check **both themes**, **320/390/1440px**, **100% and 150% text scaling**, no horizontal overflow, all five actual hit rectangles at least 44×44px and **Tab → Enter** keyboard activation with visible focus and German selection.
4. The first new browser pass detected a **test selector mistake**, not an application failure: the language navigation's accessible name changes from `Language` to `Sprache` after switching. The assertion was updated to locate the selected German button independent of the translated navigation label; the complete Chromium fixture then passed.

### Evidence and verification

- Negative-control Chromium: **40×36px** for each language in light and dark at default text size; enlarged 150% text already scaled the old controls to 60×54px.
- Post-fix independent Chromium matrix: **44×44px at default text size**, **66×66px at 150%**, across all three widths and both themes; no horizontal overflow.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** with actual Tab/Enter keyboard traversal and preserved all prior responsive, focus, translation, outage, Home and sign-out checks.
- Inspected `artifacts/agent-02/auth-language-light-320-font16.png` and `auth-language-dark-320-font24.png`: selected German button has a visible blue focus indicator; enlarged controls wrap and remain keyboard accessible.
- `npx vitest run web/src/pages/Login.test.tsx --maxWorkers=2`: **10/10 passed**.
- First full run had **453/454 passing**, with one unrelated Settings persistence navigation test timing out. That file passed **9/9 when run alone**, and a single full rerun passed **454/454 across 75 files**. No Settings code was altered.
- `npm run build -w web`: **passed**; `git diff --check`: **passed**.
- Scope limited to shared public AuthShell, its Login test, and the existing Agent B Chromium fixture; no main merge, deployment, production data, or other-agent worktrees touched.

### Next audit

- Check **public sign-in primary action and recovery links** at 320/390px and enlarged text: the normal-sized login button and small Create account / Forgot password links may be below 44px touch targets or become crowded in translated languages. Require actual Chromium measurements and avoid changes to authentication logic or backend capabilities.

## 2026-11-12: Make public sign-in and recovery actions touch-accessible

### Independent evidence

- Resumed from clean pushed `289901e` and measured actual rendered `/login` controls using Chromium in **English/German/Spanish/Russian/Bulgarian**, light and dark, **320/390/1440px**, and **16px/24px root text sizes**.
- The primary **Log in** button was only **36px tall** and both **Create account** and **Forgot password?** links only **20px tall** at default text size. At 150% root text, both links were still only **30px tall** unless text happened to wrap. All were below Patzer's 44px touch-target benchmark even though language buttons had just been corrected.
- Confirmed user-facing recovery links exist only when server capabilities authorize them; no changes to authentication logic or capability checks.

### Implementation

1. Add `min-h-11` to the existing sign-in submit button, keeping its full-width style, disabled state until credentials are entered, form submission semantics and label.
2. Change the two existing recovery links to `inline-flex min-h-11 max-w-full items-center`, keeping their destination URLs, text, colors, hover feedback and wrapping in long translated locales.
3. Add Login unit regression assertions for the size classes, original submit semantics, disabled-until-filled state and both intact link destinations.
4. Extend the end of Agent B's real Chromium shell fixture with a valid **local-only auth capabilities response**, then check the actual sign-in/recovery hit rectangles **before and after switching to German**, alongside the earlier Tab/Enter and language-button assertions. This fixture does not certify backend auth behavior.

### Verification

- Independent 50-case Chromium audit: **zero undersized controls** and **zero horizontal overflows** across all tested languages, themes, screen widths and root-font sizes. Minimum dimensions now **44px**, with 66px or taller controls at 150% scale.
- Inspected `artifacts/agent-02/auth-actions-after-light-en-320.png` and `auth-actions-after-dark-de-320.png`: links retain clear separation and mobile layouts remain balanced.
- `node web/src/components/navigation/capture-shell.mjs`: **passed**, including actual login control sizes before/after locale change and all previous responsive, keyboard, accessibility, sign-out and localization regressions.
- `npx vitest run web/src/pages/Login.test.tsx --maxWorkers=2`: **11/11 passed**.
- `npx vitest run web/src --maxWorkers=2`: **455/455 passed across 75 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No other agents' worktrees, production deployment, customer game data or main branch touched.

### Next audit

- Inspect **public sign-in username/password input target height and focus readability** in Chromium at 320px (the controls appear shorter than 44px in the audited screenshots), then examine the alternative SSO-only layout to avoid assuming all authentication configurations share the same form. Scope changes to visual/touch UI only and do not change validation or authentication flows.

## 2026-11-12: Improve password-field and SSO-only sign-in touch targets

### Independent Chromium reproduction and root cause

- Resumed from clean pushed `43d2dc8`. Audited the actual public login using local API capability fixtures for both **password** and **SSO-only** configurations, in English and German, both themes, at **320/390/1440px** and root text sizes **16px and 24px**.
- In password mode, both username and password input fields measured **38px tall** at default text size, below the 44px mobile control target. In SSO-only mode, the sole provider sign-in link measured **36px tall**.
- Adding `min-h-11` alone did not fix the inputs: the existing legacy `:where(input,textarea,select):not(...):not(...):not(...):not(...):not(...)` CSS rule forced a 38px minimum and outranked the utility. Examined live Chromium matching style rules and computed `minHeight: 38px` before choosing the correction.

### Scoped implementation

1. Add a minimum 44px height to username and password inputs and the SSO provider link in `web/src/pages/Login.tsx`; do not modify any input value, field validation, accessibility names, password semantics, OIDC redirect URL, or server capability logic.
2. Add a narrow `.auth-shell .input { min-height:2.75rem!important; }` override to `web/src/index.css` so the existing high-specificity global 38px rule cannot undo the login field minimum. This does not alter inputs outside the public authentication frame.
3. Add Login test assertions preserving the field types, autocomplete attributes, and SSO-only destination and touch sizing.
4. Extend the full Agent B Chromium shell fixture with password-field size assertions and an independent **SSO-only** browser matrix across both themes and widths. Assert SSO-only mode has no password form, a provider target at least 44×44px, and no horizontal overflow.

### Verified outcomes

- Pre-fix Chromium: **38px input targets; 36px SSO target** at normal font size.
- After scoped CSS priority correction, Chromium computed **44px** for each password field (both themes), with matching 44px SSO provider targets.
- Independent **32-case** Chromium password/SSO audit: **zero undersized targets, zero horizontal overflow**, with actual heights 44/66/84px depending on font size and wrapped translations.
- Inspected real screenshots `artifacts/agent-02/auth-sso-only-light-320-font16.png` and `auth-sso-only-dark-320-font24.png`; the single SSO action remains prominent and the 150% German translation wraps without clipping.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** including prior responsive, keyboard, multilingual, logout and first-use coverage and new password/SSO assertions.
- `npx vitest run web/src/pages/Login.test.tsx --maxWorkers=2`: **12/12 passed**.
- `npx vitest run web/src --maxWorkers=2`: **456/456 passed across 75 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No changes to backend auth, production data, deployment, main or other agents' worktrees.

### Next audit

- Audit the other **public account-recovery routes** (Forgot Password, Reset Password, Verify Email) for mobile touch-target consistency and meaningful keyboard-focus recovery in error/confirmation states. Reproduce actual shortcomings in Chromium first and prioritize the most noticeable one; leave auth request logic and server behavior unchanged.

## 2026-11-12: Keep public recovery actions touch-accessible in every state

### Browser reproduction

- Resumed from clean pushed `4415060` and inspected **Forgot Password, Reset Password and Verify Email** in Chromium using local-only auth fixtures for form, missing-token, confirmed and expired-link states, both themes, English/German, 320px/390px/1440px widths and enlarged root text.
- The submit controls were **36px high**, plain `Back to sign in` links only **17px**, and the missing-token `Request a new link` control **38px** at default text size. Verification-success and failure actions likewise failed the 44px touch-target benchmark. Input fields already received the previous scoped shared-auth CSS correction and were not changed again.
- The original 80-case reproduction had **86 undersized hit areas** and no horizontal overflow. The issue was confined to the three public recovery pages' link/button classes; form submission and token processing were already correct.

### Implementation

1. Add `min-h-11` to submit and action links in `web/src/pages/ForgotPassword.tsx`, `ResetPassword.tsx` and `VerifyEmail.tsx`. Plain back links now use `inline-flex min-h-11 max-w-full items-center justify-center` so the entire readable label has a real touch area.
2. Preserve all request URLs, server-response handling, disabled/validity guards, token conditions, labels, button colors and link destinations.
3. Add **nine unit regression tests** in `web/src/pages/AuthRecovery.touch.test.tsx`, covering initial forms, disabled buttons, email/password semantics, successful submissions and the rejected verification token path.
4. Add a durable dedicated local Chromium fixture `web/src/components/navigation/capture-auth-recovery.mjs` that exercises **nine route/outcome scenarios × both themes × English/German × 320px normal/enlarged and 1440px normal text**. It verifies each real action/input hit rectangle is at least 44px tall and wide, there is no horizontal overflow, and `document.lang` matches the selected language.

### Verified outcome

- `node web/src/components/navigation/capture-auth-recovery.mjs`: **108/108 cases passed** across form, sent, token-missing, reset-complete, verification-success and verification-failure states.
- Inspected real Chromium screenshots `artifacts/agent-02/auth-recovery-forgot-form-light-320.png`, `auth-recovery-reset-done-dark-320.png` and `auth-recovery-verify-token-failed-dark-320.png`. Touch areas remain clear, mobile hierarchy is balanced, and translations wrap without overflow.
- `npx vitest run web/src/pages/AuthRecovery.touch.test.tsx --maxWorkers=2`: **9/9 passed**.
- `npx vitest run web/src --maxWorkers=2`: **465/465 passed across 76 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No production requests, live emails, backend auth changes, main merge, deployment or modifications to other agents' worktrees.

### Next audit

- Inspect **keyboard focus and announcement after asynchronous recovery success/failure**. The form is replaced by a confirmation screen or token failure state, which may leave keyboard focus on a removed submit button or body. Reproduce with Chromium and improve focus/announcements only if the actual DOM demonstrates the defect.

## 2026-11-12: Announce recovery results and restore keyboard context after async transitions

### Measured defect

- Resumed from clean pushed `3b9731d` without repeating the previously completed touch-target audit.
- A local Chromium probe drove Forgot Password, Reset Password and verification resend forms using actual keyboard Enter and also loaded verification success/failure tokens. **All five result paths dropped focus to `BODY`** once the submitted form was replaced or asynchronous verification settled.
- The result screens had **no final `role=status`/`role=alert` announcements**. Keyboard and screen-reader users were not clearly informed of the completed step or where to navigate next, despite working action links.

### Scoped implementation

1. Add opt-in `focusTitle` to the shared `AuthShell`, implemented with a single heading ref and an effect that focuses the **result-only heading**, `tabIndex=-1` and `preventScroll`. Ordinary sign-in, signup and editable forms do **not** opt in, so their input autofocus remains intact.
2. Enable result-heading focus for sent password reset, completed password change, missing reset token, verification success/failure, and resend-verification confirmation. Only `focusTitle` changes trigger the effect; a later language switch does not steal focus back from the selected language button.
3. Label successful result bodies as `role=status`, rejected verification and missing reset token as `role=alert`, and verification progress as `role=status`. Mark the spinner decorative and respect reduced-motion preference.
4. Extend unit tests to assert focused result headings, result roles/text, preserved route links, and no focus stealing after a German language switch.
5. Extend the dedicated **108-case** Chromium recovery matrix to assert result heading focus, accessible status/alert and keyboard **Tab → next recovery link**, including genuine Enter-based form submission rather than mouse-only activation.

### Verification

- Original five-case Chromium negative control: **5/5 outcomes focused `BODY`** with no result announcement.
- Post-fix Chromium probe: **5/5 outcomes focused the correct `H2`**, with success `role=status` or rejection `role=alert`; the heading has `tabIndex=-1`.
- `node web/src/components/navigation/capture-auth-recovery.mjs`: **108/108 passed**, including keyboard navigation to the next action after result focus, both themes, both tested languages and enlarged text. A first assertion that expected `:focus-visible` after pointer submission was corrected to use keyboard Enter for keyboard-specific behavior.
- Inspected `artifacts/agent-02/auth-recovery-forgot-sent-light-320.png` and `auth-recovery-verify-token-failed-dark-320.png`: the following action link receives a visibly outlined keyboard focus ring in both themes.
- `npx vitest run web/src/pages/AuthRecovery.touch.test.tsx --maxWorkers=2`: **10/10 passed**.
- `node web/src/components/navigation/capture-shell.mjs`: **passed** (complete existing global responsive shell regressions).
- `npx vitest run web/src --maxWorkers=2`: **466/466 passed across 76 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No auth request logic, backend data, main branch, deployment or other agents' worktrees touched.

### Next audit

- Examine the **public Signup/first-owner Setup** experience at 320px and enlarged text, especially form inputs and submission buttons, to see whether the 44px minimum is applied consistently outside Login/Recovery. Avoid modifying their validation or account-creation logic; check real Chromium first.

## 2026-11-13: Consistent touch targets for Signup and first-owner Setup

### Reproduced usability defect

- Continued from clean pushed `75329c5` and its documented next audit; preserved three existing, uncommitted scoped fixes rather than restarting or resetting them.
- Independent local Chromium negative control covered Signup (open and closed capabilities) and both Setup wizard steps, in English and German, both themes, 320px normal/enlarged and 1440px normal font sizes.
- **56 undersized control instances** were measured across 48 cases. Open Signup's Create account button measured **36px tall**, the inline Log in escape link **17px tall**, and the closed-registration Back to sign in button **38px tall**. Setup's username, display-name, password and optional Ollama URL inputs measured **38px** at normal font size. Setup step actions were already 44px.
- Initial fix raised clickable heights but a second Chromium run still found four instances of the English Log in link at **40px width**, under the 44px benchmark.

### Changes in Agent B's scope

1. Add 44px minimum height to the Signup submit and sign-in return links across open, disabled, capability-error and verification-required states. Make the inline Log in link `inline-flex min-h-11 min-w-11` with centered contents; preserve link destinations, text and sign-up guards.
2. Add `setup-shell` to the owner wizard root and a **scoped** `.setup-shell .input { min-height:2.75rem!important; }` in the shared stylesheet. This overcomes the pre-existing high-specificity legacy 38px input minimum without affecting forms elsewhere in Patzer.
3. Extend Signup capability tests to cover untouched disabled submission and 44px sign-in escape; extend Setup accessibility tests to assert that initial and AI connection fields belong to the scoped setup shell.
4. Commit a dedicated `capture-auth-onboarding.mjs` local-only Chromium fixture for all **48 Signup/Setup cases**, asserting every actual input/action is at least **44×44px**, no horizontal overflow, and correct interface/document language. It only mocks local API responses and does not create accounts.

### Verification

- Post-fix **48/48 Chromium cases passed**, **0 undersized** and **0 overflowing** controls.
- Inspected `artifacts/agent-02/signup-setup-verified-signup-open-light.png`, `signup-setup-verified-setup-step1-dark.png` and `signup-setup-verified-setup-step2-light.png`; spacing, translated labels, focus outlines and action grouping remain balanced on narrow phones.
- Focused Signup/Setup tests: **7/7 passed**.
- `npx vitest run web/src --maxWorkers=2`: **467/467 passed across 76 files**.
- `npm run build -w web`: **passed**.
- `git diff --check`: **passed**.
- No account creation, auth capability, Ollama request logic, main branch, production data, deployment or other agents' worktrees changed.

### Next audit

- Verify **Signup's asynchronous registration confirmation** in actual Chromium. When a registration requires email verification, its editable form is replaced by Check your inbox; check whether the active form control loses focus and whether the result is announced. If confirmed, reuse the existing opt-in AuthShell result focus approach, keeping the account-creation logic unchanged.
