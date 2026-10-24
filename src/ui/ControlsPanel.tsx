import { useEffect, useMemo, useState } from "react";
import { useSettings } from "./SettingsContext";
import {
  BIND_ACTIONS,
  BIND_SLOTS,
  DEFAULT_KEYBINDS,
  findConflicts,
  keyLabel,
  setBinding,
  type BindAction,
  type Keybinds,
} from "./settings";

export function ControlsPanel() {
  const { settings, update } = useSettings();
  const [listening, setListening] = useState<{ action: BindAction; slot: number } | null>(null);
  const conflicts = useMemo(() => findConflicts(settings.keybinds), [settings.keybinds]);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = e.code === "Backspace" ? null : e.code;
      update((s) => ({ ...s, keybinds: setBinding(s.keybinds, listening.action, listening.slot, code) }));
      setListening(null);
    };
    const cancel = () => setListening(null);
    window.addEventListener("keydown", onKey, true);
    // A click anywhere (outside the slot that started listening) cancels.
    const t = setTimeout(() => window.addEventListener("click", cancel), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("click", cancel);
    };
  }, [listening, update]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Controls</h2>
        <button onClick={() => update((s) => ({ ...s, keybinds: structuredClone(DEFAULT_KEYBINDS) as Keybinds }))}>RESET</button>
      </div>
      <p className="hint">Click a slot, then press a key. Backspace clears the slot.</p>

      <table className="binds">
        <tbody>
          {BIND_ACTIONS.map(({ action, label }) => (
            <tr key={action}>
              <th scope="row">{label}</th>
              {Array.from({ length: BIND_SLOTS }, (_, slot) => {
                const code = settings.keybinds[action][slot];
                const isListening = listening?.action === action && listening.slot === slot;
                const conflict = code ? conflicts.get(code) : undefined;
                return (
                  <td key={slot}>
                    <button
                      className={`bind ${isListening ? "listening" : ""} ${conflict ? "conflict" : ""} ${code ? "" : "unset"}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setListening(isListening ? null : { action, slot });
                      }}
                    >
                      {isListening ? "press a key…" : keyLabel(code)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {conflicts.size > 0 && (
        <div className="warning" role="alert">
          {[...conflicts].map(([code, actions]) => (
            <div key={code}>
              ⚠ {keyLabel(code)} is bound to{" "}
              {actions.map((a) => BIND_ACTIONS.find((b) => b.action === a)!.label).join(" and ")}. Only{" "}
              {BIND_ACTIONS.find((b) => b.action === actions[0])!.label} will fire.
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
