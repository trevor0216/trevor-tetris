import { useEffect, useMemo, useRef, useState } from "react";
import type { Game } from "../engine/game";
import { GOALS } from "../modes/goals";
import { mirrorPuzzle, type LoadedPack, type Pack } from "../modes/packs";
import type { Progress } from "../modes/progress";
import type { GoalId } from "../modes/goals";
import { lockFollowsPlan, lockMatches, nextHintNeedsHold, packPlan, solverRequest, visibleHints, type HintPlan } from "../modes/hints";
import { solveInWorker } from "../solver/client";
import {
  createPuzzleGame,
  puzzleStatusAfterLock,
  solutionFrames,
  type PuzzleStatus,
} from "../modes/puzzle";
import { BoardCanvas } from "./BoardCanvas";
import { GameView } from "./GameView";
import { useSettings } from "./SettingsContext";
import { ToastStack, useToasts } from "./Toasts";
import { toastsFor } from "../modes/freeplay";
import { keyLabel } from "./settings";

// ---- pack picker ---------------------------------------------------------

export function PackPicker({ packs, progress, onPick }: { packs: LoadedPack[]; progress: Progress; onPick: (p: Pack) => void }) {
  return (
    <section className="panel list-panel">
      <h2>Puzzle packs</h2>
      {packs.length === 0 && <p className="hint">No packs found in /packs.</p>}
      <ul className="list">
        {packs.map((lp) =>
          lp.ok ? (
            <li key={lp.file}>
              <button className="list-item" onClick={() => onPick(lp.pack)}>
                <span>
                  <strong>{lp.pack.title}</strong>
                  <small className="hint">
                    Goal: {GOALS[lp.pack.goal as keyof typeof GOALS].label} · {lp.file}
                  </small>
                </span>
                <span className="count">
                  {countSolved(lp.pack, progress)}/{lp.pack.puzzles.length}
                </span>
              </button>
            </li>
          ) : (
            <li key={lp.file} className="list-item invalid">
              <span>
                <strong>{lp.file}</strong>
                <small className="error">Invalid pack: {lp.error}</small>
              </span>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

function countSolved(pack: Pack, progress: Progress): number {
  return pack.puzzles.filter((p) => progress[pack.id]?.[p.id]?.solved || progress[pack.id]?.[p.id]?.solvedMirrored).length;
}

// ---- puzzle list ---------------------------------------------------------

export function PuzzleList({ pack, progress, onPick }: { pack: Pack; progress: Progress; onPick: (index: number) => void }) {
  const sections = useMemo(() => {
    const out: { name: string; items: { index: number }[] }[] = [];
    pack.puzzles.forEach((p, index) => {
      const name = p.section ?? "Puzzles";
      let sec = out.find((s) => s.name === name);
      if (!sec) out.push((sec = { name, items: [] }));
      sec.items.push({ index });
    });
    return out;
  }, [pack]);

  return (
    <section className="panel list-panel">
      <h2>{pack.title}</h2>
      {pack.source && (
        <p className="hint">
          Source: <a href={pack.source}>{pack.source}</a>
        </p>
      )}
      {sections.map((sec) => (
        <div key={sec.name}>
          <h3>{sec.name}</h3>
          <ul className="list">
            {sec.items.map(({ index }) => {
              const p = pack.puzzles[index];
              const pr = progress[pack.id]?.[p.id] ?? {};
              return (
                <li key={p.id}>
                  <button className="list-item" onClick={() => onPick(index)}>
                    <span>
                      <strong>{p.name}</strong>
                      <small className="hint">
                        {p.queue.length} piece{p.queue.length > 1 ? "s" : ""}: {p.queue}
                        {p.hold ? ` · hold ${p.hold}` : ""}
                      </small>
                    </span>
                    <span className="badges">
                      {pr.solved && <span title="Solved">✓</span>}
                      {pr.solvedMirrored && <span title="Solved mirrored">⇋</span>}
                      {pr.clean && <span title="Solved without hints">★</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ---- puzzle --------------------------------------------------------------

interface PuzzleViewProps {
  pack: Pack;
  index: number;
  progress: Progress;
  onNavigate: (index: number) => void;
  onBack: () => void;
  onSolved: (puzzleId: string, opts: { mirrored: boolean; clean: boolean }) => void;
}

export function PuzzleView({ pack, index, progress, onNavigate, onBack, onSolved }: PuzzleViewProps) {
  const { settings } = useSettings();
  const base = pack.puzzles[index];
  const [mirrored, setMirrored] = useState(false);
  const puzzle = useMemo(() => (mirrored ? mirrorPuzzle(base) : base), [base, mirrored]);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PuzzleStatus>({ state: "playing" });
  const [hintCount, setHintCount] = useState(0);
  const [hintPlan, setHintPlan] = useState<HintPlan | null>(null);
  const [hintMsg, setHintMsg] = useState<string | null>(null);
  const gameRef = useRef<Game | null>(null);
  // Off-script = some lock didn't match the pack solution; hints then come from the solver.
  const offScript = useRef(false);
  const hintRequest = useRef(0);
  const [usedHelp, setUsedHelp] = useState(false);
  const [needsHold, setNeedsHold] = useState(false);
  const [demo, setDemo] = useState(false);
  const [toasts, pushToasts] = useToasts();
  const statusRef = useRef(status);
  statusRef.current = status;

  const resetAttempt = () => {
    setStatus({ state: "playing" });
    setHintCount(0);
    setHintPlan(null);
    setHintMsg(null);
    setUsedHelp(false);
    offScript.current = false;
    hintRequest.current++;
    setNeedsHold(false);
  };

  // New puzzle, side or retry: fresh attempt.
  useEffect(() => {
    resetAttempt();
    setDemo(false);
  }, [base.id, mirrored, attempt]);

  const restartKey = keyLabel(settings.keybinds.restart.find(Boolean) ?? null);
  const pr = progress[pack.id]?.[base.id] ?? {};
  const shownHints = hintPlan ? Math.min(hintCount, hintPlan.steps.length) : 0;
  const goal = pack.goal as GoalId;

  const requestHint = () => {
    setUsedHelp(true);
    const g = gameRef.current;
    if (hintPlan && g && g.stats.pieces - hintPlan.base + hintCount < hintPlan.steps.length) {
      setHintCount((c) => c + 1);
      return;
    }
    if (!g) return;
    if (!offScript.current) {
      const plan = packPlan(puzzle, g.stats.pieces);
      setHintPlan(plan);
      setHintCount(plan ? 1 : 0);
      setHintMsg(null);
      return;
    }
    const req = solverRequest(puzzle, goal, g, 400_000);
    if (!req) return;
    const id = ++hintRequest.current;
    setHintMsg("Thinking…");
    solveInWorker(req).then(({ plan, exhausted }) => {
      // Ignore answers for a board that has since changed.
      if (id !== hintRequest.current || gameRef.current?.stats.pieces !== req.base) return;
      setHintPlan(plan);
      setHintCount(plan ? 1 : 0);
      setHintMsg(plan ? null : exhausted ? "No TST is possible from here. Retry to start over." : "Couldn't find a solution in time. Retry to start over.");
    });
  };

  if (demo) {
    return (
      <div className="play-layout">
        <SolutionReplay puzzle={puzzle} />
        <aside className="panel puzzle-side">
          <h2>{base.name}</h2>
          <p className="hint">Showing the full solution{mirrored ? " (mirrored)" : ""}.</p>
          <button className="primary" onClick={() => setDemo(false)}>
            Back to puzzle
          </button>
        </aside>
      </div>
    );
  }

  return (
    <div className="play-layout">
      <div className="board-wrap">
        <GameView
          resetKey={`${pack.id}/${base.id}/${mirrored}/${attempt}`}
          createGame={() => (gameRef.current = createPuzzleGame(puzzle, settings.handling))}
          handling={settings.handling}
          keybinds={settings.keybinds}
          overlay={(g: Game) => ({ hints: visibleHints(hintPlan, g.stats.pieces, shownHints) })}
          onFrame={(g) => {
            gameRef.current = g;
            const h = shownHints > 0 && nextHintNeedsHold(hintPlan, g);
            if (h !== needsHold) setNeedsHold(h);
          }}
          onLock={(r, g) => {
            pushToasts(toastsFor(r));
            if (!lockMatches(puzzle.solution[g.stats.pieces - 1], r)) offScript.current = true;
            // Going off the hinted line invalidates the plan; the next Hint re-plans.
            if (hintPlan && !lockFollowsPlan(hintPlan, r, g.stats.pieces)) {
              setHintPlan(null);
              setHintCount(0);
            }
            hintRequest.current++;
            setHintMsg(null);
            if (statusRef.current.state !== "playing") return;
            const st = puzzleStatusAfterLock(goal, g, r);
            setStatus(st);
            if (st.state === "won") onSolved(base.id, { mirrored, clean: !usedHelp });
          }}
          onRestart={(g) => {
            gameRef.current = g;
            resetAttempt();
          }}
          onForfeit={onBack}
        />
        <ToastStack toasts={toasts} />
        {status.state === "won" && (
          <div className="banner win">
            T-Spin Triple! Solved.
            {index + 1 < pack.puzzles.length && (
              <button className="primary" onClick={() => onNavigate(index + 1)}>
                Next →
              </button>
            )}
          </div>
        )}
        {status.state === "failed" && (
          <div className="banner fail">
            {status.reason} Press {restartKey} to retry.
          </div>
        )}
      </div>

      <aside className="panel puzzle-side">
        <div className="panel-head">
          <h2>{base.name}</h2>
          <span className="badges">
            {pr.solved && <span title="Solved">✓</span>}
            {pr.solvedMirrored && <span title="Solved mirrored">⇋</span>}
            {pr.clean && <span title="Solved without hints">★</span>}
          </span>
        </div>
        {base.section && <p className="hint">{base.section}</p>}
        <p>
          Goal: <strong>{GOALS[pack.goal as keyof typeof GOALS].label}</strong> · Queue <code>{puzzle.queue}</code>
          {puzzle.hold && (
            <>
              {" "}
              · Hold <code>{puzzle.hold}</code>
            </>
          )}
          {!puzzle.allowHold && " · hold disabled"}
        </p>

        <div className="row wrap">
          <button onClick={requestHint} disabled={status.state !== "playing"}>
            {shownHints === 0 ? "Hint" : "Next hint step"}
          </button>
          <button
            onClick={() => {
              setUsedHelp(true);
              setDemo(true);
            }}
          >
            Show full solution
          </button>
          <button onClick={() => setAttempt((a) => a + 1)}>Retry ({restartKey})</button>
        </div>
        {shownHints > 0 && (
          <p className="hint">
            Showing {shownHints} step{shownHints > 1 ? "s" : ""} as dashed outlines.
            {needsHold && <strong> Hold first: the next step uses a different piece.</strong>}
          </p>
        )}
        {hintMsg && <p className="hint">{hintMsg}</p>}
        {base.notes && <p className="notes">{base.notes}</p>}

        <label className="toggle">
          <input type="checkbox" checked={mirrored} onChange={(e) => setMirrored(e.target.checked)} />
          <span>
            Mirror
            <small className="hint">Flip the board and swap L↔J, S↔Z to practice the other side.</small>
          </span>
        </label>

        <div className="row">
          <button disabled={index === 0} onClick={() => onNavigate(index - 1)}>
            ← Prev
          </button>
          <span className="hint">
            {index + 1} / {pack.puzzles.length}
          </span>
          <button disabled={index + 1 >= pack.puzzles.length} onClick={() => onNavigate(index + 1)}>
            Next →
          </button>
        </div>
      </aside>
    </div>
  );
}

function SolutionReplay({ puzzle }: { puzzle: Parameters<typeof solutionFrames>[0] }) {
  const frames = useMemo(() => solutionFrames(puzzle), [puzzle]);
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    const t = setInterval(() => setI((x) => (x + 1) % (frames.length + 2)), 700);
    return () => clearInterval(t);
  }, [frames]);
  // Hold on the final frame for a beat before looping.
  return <BoardCanvas state={frames[Math.min(i, frames.length - 1)]} />;
}
