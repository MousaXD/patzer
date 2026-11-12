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
