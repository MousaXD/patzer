# Patzer variation move quality — Agent 06 integration contract

**Owner:** Agent 06. **Consumers:** Agents 03 (analysis workspace) and 04 (variation state).
**Source of truth:** existing `server/src/chess/classifier.ts` scoring version; no frontend classification calculations.

## Endpoint

`POST /api/analyze/variation-move` (authenticated; same `X-Requested-With: patzer` CSRF header as other POSTs).

Request JSON:

```json
{
  "fen_before": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "move_uci": "e2e4",
  "depth": 16,
  "ply": 1
}
```

- `fen_before`: legal, six-field FEN of the **parent position**, maximum 128 characters. Reject malformed, game-over positions.
- `move_uci`: legal UCI move (4 characters, or 5 with `q`, `r`, `b`, `n` promotion suffix). Validation is performed with chess.js. En passant and castling use normal UCI; promotion MUST supply its suffix.
- `depth`: optional integer 8–22, default 16.
- `ply`: optional absolute 1-based ply for the move, range 1–1024. If omitted, derived from the fullmove number and side to move in the FEN. This determines the existing Brilliant/Great opening-phase eligibility, but **not** Book status.
- Never send `game_id` or PGN. The variation endpoint is deliberately independent of saved games.

Successful `200` response:

```json
{
  "quality": {
    "source": "variation",
    "scoring_version": 9,
    "fen_before": "<normalized parent FEN>",
    "fen_after": "<normalized resulting FEN>",
    "ply": 1,
    "san": "e4",
    "uci": "e2e4",
    "from": "e2",
    "to": "e4",
    "classification": "best",
    "centipawn_loss": 0,
    "win_pct_drop": 0,
    "eval_before_cp": 50,
    "eval_after_cp": 50,
    "mate_before": null,
    "mate_after": null,
    "best_move_uci": "e2e4",
    "best_move_san": "e4",
    "best_pv": ["e4"],
    "is_best": true,
    "legal_move_count": 20,
    "depth_before": 16,
    "depth_after": 16,
    "candidate_count": 2,
    "terminal": null
  }
}
```

Illustrative values above are **schema examples, not guaranteed Stockfish results**. Import the exact `VariationMoveQuality` frontend type from `web/src/lib/classification.tsx`.

- Evaluations and mate numbers are reported from **White's perspective**, matching stored `AnalyzedMove` data; `centipawn_loss` and `win_pct_drop` describe damage to the **moving player's** position.
- `best_move_uci`, `best_move_san`, and `best_pv` come from the **position before** the played move; they provide the suggested arrow and explanatory alternative.
- `depth_before`, `depth_after` report the engine's actual depth; `depth_after` is `null` when the resulting position is terminal. `terminal` is `checkmate`, `draw`, or `null`.
- `classification` is one of `brilliant`, `great`, `best`, `excellent`, `good`, `book`, `inaccuracy`, `mistake`, `blunder`, `miss`, `forced`. Exploratory moves always set `inBook: false`, so this endpoint does **not** invent book moves. Great and Brilliant still require the existing classifier's conditions and enough engine evidence.
- Engine best/alternate scores are based on MultiPV=3 for the parent position and a follow-up position evaluation; mate and turn sign are handled on the server. Engine failure does not produce a guessed move label.

Errors: `400 invalid_input`, `invalid_fen`, `invalid_move`, `terminal_position`; `429 already_analyzing` (also returned if another position analysis for this user is running); `503 engine_error`; `504 engine_timeout`. No partial classification is returned in errors. Treat all failures as **unscored**; do not synthesize a Best/Good badge.

## Integration with Agent 04 variation state

1. On a legal new variation move, record `fen_before`, `move_uci`, the resulting expected FEN from chess.js, and a generation/selection ID in variation state.
2. Debounce or cancel stale requests when the user changes positions. `/variation-move` rejects parallel analyses for the same user; on `429`, retry only if that same move is still selected, with modest backoff (avoid a request storm).
3. On response, apply the quality **only** if the current selection/generation still matches and `quality.fen_after` equals the currently selected resulting FEN. Helper `qualityMatchesPosition(quality, fen)` enforces the FEN half of this check.
4. Cache classifications by `(fen_before, move_uci, depth, scoring_version)` if desired, never just by ply number. A different variation at the same ply must not inherit the original game's classification.
5. On back/forward navigation show the stored game's original classification only for its matching original line, or the correctly cached variation classification. At a freshly selected, still-unscored position show no badge.
6. This endpoint is read-only, so do not update or store `analyses`, `games`, or saved PGN for exploratory moves.

## Integration with Agent 03 board/workspace

- Existing board overlay: `<ClassificationBadge classification={quality.classification} square={quality.to} orientation={orientation} evaluatedFenAfter={quality.fen_after} activeFen={currentFen} label={translatedLabel} />` as a child of the `position:relative` **square board wrapper**. For original game review use stored `move.classification` and `pos.to` as before.
- The badge uses percentage-based coordinates, flips with board orientation, clamps near edges, has an accessible `role=img` label, is SVG-only and does not capture pointer events. The square-outline layer highlights the destination without replacing Chessground's existing last-move highlight. If an existing layer already highlights the destination, pass `highlightDestination={false}`.
- The original Chessground arrows remain the source of truth. In variation mode, draw the suggested alternative arrow from `quality.best_move_uci` **only when it differs from `quality.uci`**, using the workspace's existing arrow implementation. No duplicate arrow layer is introduced.
- Badge visibility must be tied to selected position and scoring state. The stateless badge does not subscribe to engine requests or variation history.
- The button labels in MoveRow remain keyboard accessible and expose the classification via `aria-label`. Arrow-key playback stays owned by the workspace.

## Safety and verification

- The route reuses `requireAuth`, the existing app-wide CSRF middleware, per-user position single-flight protection and the configured engine backend. Request depth, FEN length, move format and ply are bounded; chess.js validates the actual position/move. The scoring utility enforces a bounded timeout and quits the engine on success/failure.
- No database mutations occur in the scoring utility or variation endpoint. Existing persisted Game Review analysis uses the unchanged classifier.
- Run from repo root: `npm ci && npm run typecheck && npm test -- --run server/test/variation-scoring.test.ts web/src/components/ClassificationBadge.test.tsx && npm run build`. GitHub CI has `pull_request` triggers scoped to `main` in `.github/workflows/ci.yml`; a PR against the integration branch may require Agent 00 to arrange an equivalent exact-head run without relaxing test gates.
