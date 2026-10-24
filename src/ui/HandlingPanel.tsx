import { useState } from "react";
import { Game } from "../engine/game";
import { DEFAULT_HANDLING } from "../engine/handling";
import { BagQueue } from "../engine/queue";
import { GameView } from "./GameView";
import { useSettings } from "./SettingsContext";
import { HANDLING_SLIDERS, HANDLING_TOGGLES, clampSlider, formatSlider } from "./settings";

export function HandlingPanel() {
  const { settings, update } = useSettings();
  const [testing, setTesting] = useState(false);
  const h = settings.handling;

  return (
    <div className="handling">
      <section className="panel">
        <div className="panel-head">
          <h2>Handling</h2>
          <div className="row">
            <button onClick={() => update((s) => ({ ...s, handling: { ...DEFAULT_HANDLING } }))}>RESET</button>
            <button className={testing ? "primary" : ""} onClick={() => setTesting((t) => !t)}>
              {testing ? "CLOSE TEST" : "TEST"}
            </button>
          </div>
        </div>

        {HANDLING_SLIDERS.map((spec) => (
          <div className="slider" key={spec.key} title={spec.hint}>
            <label htmlFor={`h-${spec.key}`}>{spec.label}</label>
            <input
              id={`h-${spec.key}`}
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={h[spec.key]}
              onChange={(e) => {
                const v = clampSlider(spec, Number(e.target.value));
                update((s) => ({ ...s, handling: { ...s.handling, [spec.key]: v } }));
              }}
            />
            <output htmlFor={`h-${spec.key}`}>{formatSlider(spec.key, h[spec.key])}</output>
            <p className="hint">{spec.hint}</p>
          </div>
        ))}

        {HANDLING_TOGGLES.map((t) => (
          <label className="toggle" key={t.key} title={t.hint}>
            <input
              type="checkbox"
              checked={h[t.key]}
              onChange={(e) => update((s) => ({ ...s, handling: { ...s.handling, [t.key]: e.target.checked } }))}
            />
            <span>
              {t.label}
              <small className="hint">{t.hint}</small>
            </span>
          </label>
        ))}
      </section>

      {testing && (
        <section className="panel test-board">
          <h2>Test board</h2>
          <p className="hint">Changes apply live. Drag the sliders with the mouse; your bound keys control the board.</p>
          <GameView
            createGame={() => new Game({ queue: new BagQueue(Math.floor(Math.random() * 2147483646) + 1) })}
            handling={h}
            keybinds={settings.keybinds}
            onForfeit={() => setTesting(false)}
          />
        </section>
      )}
    </div>
  );
}
