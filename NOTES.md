# TST Trainer — engine notes and sources

Every constant and table in `src/engine` below was checked against at least one
external source. Where two sources exist they were compared entry by entry
(the comparison is automated in `tests/kicks.test.ts`).

## Sources

| Key | Source | Notes |
|---|---|---|
| HD-SRS | Hard Drop wiki, "SRS" — <https://harddrop.com/wiki?title=SRS&action=raw> (fetched 2026-10-24) | Guideline J/L/S/T/Z and I kick tables; section "SRS+" gives TETR.IO's I kick table. y-up. |
| TW-TETRIO | tetris.wiki, "TETR.IO" — <https://tetris.wiki/TETR.IO> (fetched 2026-10-24) | Confirms SRS+ is the default rotation system since Alpha 5.0.0; describes the 180 table. |
| OSK-180 | osk's official "TETR.IO 180 KICK TABLE" diagram — <https://tetris.wiki/images/5/52/TETR.IO_180kicks.png> | Pinned by TETR.IO's developer in the official Discord; J/L/S/T/Z 180 kicks. |
| TRI | Triangle.js (`@haelp/teto`), a TETR.IO engine reimplementation that replays real TETR.IO games — <https://github.com/halp1/triangle> at commit `14418545c7e8249efbb452ea953ddd4961b7a696` | `src/engine/utils/kicks/data.ts` (kicks, corner table), `src/engine/index.ts` (timing, spin detection, DAS), `src/engine/utils/tetromino/*` (shapes, spawn), `src/engine/utils/rng/index.ts` (PRNG), `src/classes/room/presets.ts` and `test/engine/replay.ts` (default game options). Stores kicks y-down. |
| HD-TST | Hard Drop wiki, "T-Spin Triple Setups" — <https://harddrop.com/wiki?title=T-Spin_Triple_Setups&action=raw> | Iso TST ("TrIso") diagrams used in `tests/tspin.test.ts`. |

## Kick tables (`src/engine/kicks.ts`)

- **J/L/S/T/Z 90°**: HD-SRS table = TRI `SRS+.kicks` (y flipped). Identical to Guideline SRS.
- **I 90° (SRS+)**: HD-SRS "SRS+ I tetromino wall kick data" = TRI `SRS+.i_kicks`. Differs from Guideline I kicks (left-side tables mirrored).
- **J/L/S/T/Z 180°**: OSK-180 = TRI `SRS+.kicks["02"|"20"|"13"|"31"]`. N→S includes (+1, 0) and (−1, 0) as kicks 4 and 5 ("right/left zipper"), which is what enables the Iso TST.
- **I 180°**: TRI only (single test each: 0→2 (0,+1), 2→0 (0,−1), 1→3 (+1,0), 3→1 (−1,0)). OSK-180 shows T only. **Single-sourced.**
- **O**: never kicks (all four states identical, so the unkicked test always fits).
- **TST / fin kick**: the 4th 90° kick, (−1,−2) for 0→R and 2→R, (+1,−2) for 0→L and 2→L. TRI `#isTSpinKick` forces any T-spin that used it to full.

## Timing and game constants (`src/engine/game.ts`)

| Constant | Value | Source |
|---|---|---|
| Board | 10 × 20 visible + 20 buffer | TRI presets `boardwidth 10`, `boardheight 20`; replay test `buffer: 20` |
| Spawn | box left = floor(5 − w/2); box top = row 22.04 (y-up, row 0 = bottom) | TRI `Tetromino` constructor (`boardHeight + 2.04`). Lowest spawn cells sit in row 21; gravity moves the piece to row 20 after 2 frames |
| Gravity | 0.02 rows/frame | TRI presets `options.g 0.02` |
| Lock delay | 30 frames (locks once grounded time **exceeds** 30) | TRI presets `options.locktime 30`; `#__internal_lock` uses `>` |
| Lock resets | 15 | TRI replay defaults `lockresets ?? 15`. Every successful move/rotate counts (even in the air); the count resets when the piece reaches a new lowest row; a grounded piece at 15 locks immediately |
| ARE / line clear ARE | 0 | TRI presets `are 0`, `lineclear_are 0` |
| Randomizer | 7-bag, Park–Miller LCG (×16807 mod 2³¹−1), Fisher–Yates over Z L O S I J T | TRI `rng/index.ts`, `queue/rng/bag7.ts` |
| Next previews | 5 | TRI presets `nextcount 5` |
| Spin rule | "T-spins" | TRI presets `spinbonuses "T-spins"` (default room). Recent ranked/QP default is "all-mini+", which only adds non-T minis |
| Soft drop | rows/frame = max(gravity × SDF, 0.05 × SDF); SDF 41 = ∞ (400 rows/frame) | TRI `#fall`. At defaults (0.02 G, 40×): 2 rows/frame |
| Safe lock | hard drop ignored for 7 frames after a piece locks by itself | TRI `#fall` (`safeLock = 7`) |

## T-spin detection (`detectTSpin` in `src/engine/movement.ts`)

TRI `#detectSpinFromCorners`:
1. T piece, last successful action was a rotation (any successful shift or fall clears it).
2. The piece cannot move down one row.
3. At least 3 of the 4 diagonal cells around the T's center are blocked (walls and floor count).
4. Full if both front corners (the two on the side the T points to) are blocked, **or** the rotation used the TST/fin kick. Otherwise mini.

## Handling (`src/engine/handling.ts`): how TETR.IO actually does it

All values are frames, processed at subframe precision (TRI `#processShift`, `#keydown`, `#keyup`):

- **DAS**: charges by elapsed (fractional) frames from the key press; the initial tap moves one cell immediately.
- **ARR**: after DAS is charged, one cell every ARR frames; ARR 0 moves to the wall in the same subframe the charge completes.
- **DCD**: on rotate, hold, or spawn, *if the last shift was blocked by a wall or stack*, both directions' DAS charge is capped at DAS − DCD. In practice auto-shift pauses for DCD frames after a rotation or spawn while you're holding into a wall. (The spec says "pause auto-shift for N frames after a rotate, hold, or new piece spawn"; TETR.IO only does this when the piece is against a wall. We follow TETR.IO.)
- **Cancel DAS when changing directions**: pressing a direction always starts its own DAS from 0. On *releasing* it while the other direction is still held: if cancel is ON, the held direction's charge resets to 0; if OFF, it resumes with its stored charge (often an instant slide).
- **Prefer soft drop over movement** (TETR.IO's `may20g`): when soft drop is effectively 20G (SDF ∞), every successful shift is followed by a slam to the floor, so the piece hugs the stack while sliding. With it off, a slide finishes before gravity applies.
- **Prevent accidental hard drops** (TETR.IO's `safelock`): hard drop is ignored for 7 frames after a piece locks *by itself*. (The spec describes it as "right after a piece spawns while hard drop is still held". In TETR.IO it's tied to natural locks, which is the case where a held or mashed hard drop would wrongly hit the next piece. We follow TETR.IO.)

## Deliberate deviations and open items

- **Shift clears the spin**: TRI's keyboard shift path does not clear `lastSpin`, but its public move API and the Guideline do. We clear it on any successful shift. This only matters for a shift that lands in another 3-corner immobile spot, which is rare.
- **IRS / IHS** (initial rotation/hold) are not implemented.
- **Finite queues** (puzzles): when the queue is empty and hold has a piece, that piece spawns next. When both are empty the game ends with `queue-empty`.
- **Lock out** is disabled (TRI presets `nolockout true`). **Clutch clears** are on: after a line clear, a blocked spawn is pushed up instead of topping out.

## Solver (`src/solver`)

- **Placement search**: BFS from the spawn position over shift ±1, rotate CW/CCW/180 (the same `tryRotate` as the engine), one-row fall and sonic drop. Every resting position gets the best spin reachable by a final rotation, plus a shortest input path. Positions covering identical cells (I/S/Z/O rotations) are merged.
- **Assumption**: gravity is slow enough to stand still in the air (true at TETR.IO's 0.02 G). Lock resets aren't modeled in the search.
- **Sequence search**: depth-first over the queue, with hold as a choice. It uses iterative deepening, so the shortest (fewest pieces) solution wins, and memoizes failed (board, queue, hold) states. Placements that leave blocks in row 21 or higher are pruned because they'd block the spawn. The node budget bounds run time; `exhausted: false` means "ran out of budget", not "no answer".
- **Verification** (`verify.ts`): replays each placement's path through the real `Game` with key taps. Gravity is 0, so pieces wait between inputs; a one-row step is a soft drop at SDF 5 and a sonic drop is a soft drop at ∞. It then checks each lock's cells and that only the final lock meets the goal. This exercises the real lock-reset limit, kicks and spin detection.
- **Speed**: about 50 µs per explored placement. A 5–7 piece queue that has no answer can take seconds to rule out, which is why UI hints use the pack's verified solution while the player is on-script, and the solver (in a Web Worker, 400k-node budget) only after they've gone off-script.

## Pack building (`scripts/build-pack.ts`, `scripts/lib/`)

- **Source**: Hard Drop wiki raw wikitext (`?action=raw`). The rendered HTML only has images; the diagrams are `{{pfstart}}`/`{{pfrow|…}}`/`{{pfend}}` templates. Raw pages are cached in `.cache/wiki/`.
- **Cell codes** (Template:Pfstart legend): space = empty; `G`/`g`/`B`/`C` = garbage; `IJLOSZ` either case = colored blocks; `T`/`t`/`P`/`p` = T; `-…` = ghost or line-clear marker (empty); `X` and digits = annotations (empty). A row with ≥5 `-` cells shows a line clear in progress and the diagram is rejected.
- **Generation** (`puzzle-gen.ts`): every diagram becomes a ready-slot puzzle (depicted T removed), up to 2 build variants (nearest uncovered setup pieces moved into the queue; kept only if T alone no longer works), or a completion (shortest 1–2 extra pieces). Every puzzle is solved and replayed through the engine before it's written.
- **tst-setups.json**: 206 puzzles from HD-TST plus the "T-Spin Triple Setups/Base" and "/Overhang" pages. Coverage, drops and out-of-scope sections are in `packs/tst-setups.report.md`.
