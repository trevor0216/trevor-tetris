import { useState } from "react";
import { Game } from "../engine/game";
import { BagQueue } from "../engine/queue";
import { ControlsPanel } from "./ControlsPanel";
import { GameView } from "./GameView";
import { HandlingPanel } from "./HandlingPanel";
import { useSettings } from "./SettingsContext";

type Screen = "menu" | "play" | "settings";
type SettingsTab = "handling" | "controls";

export function App() {
  const [screen, setScreen] = useState<Screen>("menu");
  const [tab, setTab] = useState<SettingsTab>("handling");
  const { settings } = useSettings();

  return (
    <div className="app">
      <header>
        <button className="brand" onClick={() => setScreen("menu")}>
          TST TRAINER
        </button>
        {screen !== "menu" && (
          <button className="ghost" onClick={() => setScreen("menu")}>
            ← Menu
          </button>
        )}
      </header>

      {screen === "menu" && (
        <nav className="menu">
          <button className="menu-item" onClick={() => setScreen("play")}>
            <strong>PLAY</strong>
            <span>Endless 7-bag sandbox (Free Play arrives in Phase 3)</span>
          </button>
          <button className="menu-item" onClick={() => setScreen("settings")}>
            <strong>SETTINGS</strong>
            <span>Handling and controls</span>
          </button>
        </nav>
      )}

      {screen === "play" && (
        <GameView
          createGame={() => new Game({ queue: new BagQueue(Math.floor(Math.random() * 2147483646) + 1) })}
          handling={settings.handling}
          keybinds={settings.keybinds}
          onForfeit={() => setScreen("menu")}
        />
      )}

      {screen === "settings" && (
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
