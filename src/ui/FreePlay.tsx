import { useRef, useState } from "react";
import type { Game } from "../engine/game";
import { createFreePlayGame, statsOf, toastsFor, type FreePlayStats } from "../modes/freeplay";
import { GameView } from "./GameView";
import { useSettings } from "./SettingsContext";
import { ToastStack, useToasts } from "./Toasts";
import { keyLabel } from "./settings";

export function FreePlay({ onExit }: { onExit: () => void }) {
  const { settings } = useSettings();
  const [stats, setStats] = useState<FreePlayStats | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [toasts, pushToasts] = useToasts();
  const lastHud = useRef(0);

  const refresh = (g: Game) => {
    setStats(statsOf(g));
    setOver(g.over);
  };

  const restartKey = keyLabel(settings.keybinds.restart.find(Boolean) ?? null);

  return (
    <div className="play-layout">
      <div className="board-wrap">
        <GameView
          createGame={() => createFreePlayGame(settings.handling)}
          handling={settings.handling}
          keybinds={settings.keybinds}
          onLock={(r, g) => {
            pushToasts(toastsFor(r));
            refresh(g);
          }}
          onFrame={(g) => {
            const now = performance.now();
            if (now - lastHud.current > 200) {
              lastHud.current = now;
              refresh(g);
            }
          }}
          onRestart={refresh}
          onForfeit={onExit}
        />
        <ToastStack toasts={toasts} />
        {over && (
          <div className="banner fail">
            {over === "topout" ? "Topped out" : "Game over"}. Press {restartKey} to restart.
          </div>
        )}
      </div>

      <aside className="panel stats">
        <h2>Stats</h2>
        <dl>
          <Stat label="Time" value={formatTime(stats?.seconds ?? 0)} />
          <Stat label="Pieces" value={stats?.pieces ?? 0} />
          <Stat label="PPS" value={(stats?.pps ?? 0).toFixed(2)} />
          <Stat label="Lines" value={stats?.lines ?? 0} />
          <Stat label="TST" value={stats?.tst ?? 0} accent />
          <Stat label="TSD" value={stats?.tsd ?? 0} />
          <Stat label="TSS" value={stats?.tss ?? 0} />
          <Stat label="Minis" value={stats?.minis ?? 0} />
          <Stat label="Quads" value={stats?.quads ?? 0} />
          <Stat label="B2B" value={`${stats?.b2b ?? 0} (best ${stats?.maxB2b ?? 0})`} />
          <Stat label="Combo" value={`${stats?.combo ?? 0} (best ${stats?.maxCombo ?? 0})`} />
        </dl>
        <p className="hint">{restartKey} to restart · {keyLabel(settings.keybinds.forfeit.find(Boolean) ?? null)} to exit</p>
      </aside>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={accent ? "accent" : ""}>{value}</dd>
    </>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}
