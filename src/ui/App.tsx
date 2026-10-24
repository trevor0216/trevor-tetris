import { useMemo, useState } from "react";
import { discoverPacks, type Pack } from "../modes/packs";
import { loadProgress, markSolved } from "../modes/progress";
import { ControlsPanel } from "./ControlsPanel";
import { FreePlay } from "./FreePlay";
import { HandlingPanel } from "./HandlingPanel";
import { PackPicker, PuzzleList, PuzzleView } from "./PuzzleScreens";

type Screen =
  | { name: "menu" }
  | { name: "freeplay" }
  | { name: "settings" }
  | { name: "packs" }
  | { name: "puzzles"; pack: Pack }
  | { name: "puzzle"; pack: Pack; index: number };

type SettingsTab = "handling" | "controls";

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: "menu" });
  const [tab, setTab] = useState<SettingsTab>("handling");
  const packs = useMemo(discoverPacks, []);
  const [progress, setProgress] = useState(loadProgress);

  const back = (): Screen => {
    switch (screen.name) {
      case "puzzle":
        return { name: "puzzles", pack: screen.pack };
      case "puzzles":
        return { name: "packs" };
      default:
        return { name: "menu" };
    }
  };

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => setScreen({ name: "menu" })}>
          TST TRAINER
        </button>
        {screen.name !== "menu" && (
          <button className="ghost" onClick={() => setScreen(back())}>
            ← Back
          </button>
        )}
      </header>

      {screen.name === "menu" && (
        <nav className="menu">
          <button className="menu-item" onClick={() => setScreen({ name: "packs" })}>
            <strong>PUZZLES</strong>
            <span>Drill T-Spin Triple setups with fixed queues</span>
          </button>
          <button className="menu-item" onClick={() => setScreen({ name: "freeplay" })}>
            <strong>FREE PLAY</strong>
            <span>Endless 7-bag with stats</span>
          </button>
          <button className="menu-item" onClick={() => setScreen({ name: "settings" })}>
            <strong>SETTINGS</strong>
            <span>Handling and controls</span>
          </button>
        </nav>
      )}

      {screen.name === "freeplay" && <FreePlay onExit={() => setScreen({ name: "menu" })} />}

      {screen.name === "packs" && (
        <PackPicker packs={packs} progress={progress} onPick={(pack) => setScreen({ name: "puzzles", pack })} />
      )}

      {screen.name === "puzzles" && (
        <PuzzleList
          pack={screen.pack}
          progress={progress}
          onPick={(index) => setScreen({ name: "puzzle", pack: screen.pack, index })}
        />
      )}

      {screen.name === "puzzle" && (
        <PuzzleView
          key={screen.pack.id}
          pack={screen.pack}
          index={screen.index}
          progress={progress}
          onNavigate={(index) => setScreen({ name: "puzzle", pack: screen.pack, index })}
          onBack={() => setScreen({ name: "puzzles", pack: screen.pack })}
          onSolved={(puzzleId, opts) => setProgress((p) => markSolved(p, screen.pack.id, puzzleId, opts))}
        />
      )}

      {screen.name === "settings" && (
        <div className="settings">
          <div className="tabs" role="tablist">
            {(["handling", "controls"] as SettingsTab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t.toUpperCase()}
              </button>
            ))}
          </div>
          {tab === "handling" ? <HandlingPanel /> : <ControlsPanel />}
        </div>
      )}
    </div>
  );
}
