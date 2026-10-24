import { DEFAULT_HANDLING, FRAME_MS, SDF_INFINITE, type Handling } from "../engine/handling";
import type { Action } from "../engine/types";

/** Engine actions plus UI-level ones. */
export type BindAction = Action | "forfeit" | "restart";

export const BIND_ACTIONS: { action: BindAction; label: string }[] = [
  { action: "moveLeft", label: "Move left" },
  { action: "moveRight", label: "Move right" },
  { action: "softDrop", label: "Soft drop" },
  { action: "hardDrop", label: "Hard drop" },
  { action: "rotateCCW", label: "Rotate CCW" },
  { action: "rotateCW", label: "Rotate CW" },
  { action: "rotate180", label: "Rotate 180" },
  { action: "hold", label: "Hold" },
  { action: "forfeit", label: "Forfeit / exit" },
  { action: "restart", label: "Restart" },
];

export const BIND_SLOTS = 3;

/** Three slots per action; null = [NOT SET]. Values are KeyboardEvent.code. */
export type Keybinds = Record<BindAction, (string | null)[]>;

const one = (code: string): (string | null)[] => [code, null, null];

export const DEFAULT_KEYBINDS: Readonly<Keybinds> = {
  moveLeft: one("ArrowLeft"),
  moveRight: one("ArrowRight"),
  softDrop: one("ArrowDown"),
  hardDrop: one("Space"),
  rotateCCW: one("KeyZ"),
  rotateCW: one("ArrowUp"),
  rotate180: one("KeyX"),
  hold: one("KeyC"),
  forfeit: one("Escape"),
  restart: one("KeyR"),
};

export interface Settings {
  handling: Handling;
  keybinds: Keybinds;
}

export interface SliderSpec {
  key: "arr" | "das" | "dcd" | "sdf";
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

export const HANDLING_SLIDERS: SliderSpec[] = [
  { key: "arr", label: "ARR", hint: "Auto repeat rate: frames between auto-shift steps. 0 = instant to the wall.", min: 0, max: 5, step: 0.1 },
  { key: "das", label: "DAS", hint: "Delayed auto shift: how long to hold before auto-shift starts.", min: 1, max: 20, step: 0.1 },
  { key: "dcd", label: "DCD", hint: "DAS cut delay: pause auto-shift after rotate, hold or spawn while against a wall.", min: 0, max: 20, step: 0.1 },
  // SDF_INFINITE (41) sits one step past 40 and means ∞.
  { key: "sdf", label: "SDF", hint: "Soft drop factor: multiplier on gravity while soft dropping.", min: 5, max: SDF_INFINITE, step: 1 },
];

export const HANDLING_TOGGLES: { key: "preventAccidentalHardDrops" | "cancelDasOnDirectionChange" | "preferSoftDrop"; label: string; hint: string }[] = [
  { key: "preventAccidentalHardDrops", label: "Prevent accidental hard drops", hint: "Ignore hard drop for 7 frames after a piece locks by itself." },
  { key: "cancelDasOnDirectionChange", label: "Cancel DAS when changing directions", hint: "Releasing one direction while holding the other restarts the held direction's charge." },
  { key: "preferSoftDrop", label: "Prefer soft drop over movement", hint: "With ∞ SDF, keep the piece on the floor while it moves." },
];

export function defaultSettings(): Settings {
  return {
    handling: { ...DEFAULT_HANDLING },
    keybinds: structuredClone(DEFAULT_KEYBINDS) as Keybinds,
  };
}

/** "5.5F (92 ms)" style readout pieces. */
export function framesToMs(frames: number): number {
  return Math.round(frames * FRAME_MS);
}

export function formatSlider(key: SliderSpec["key"], value: number): string {
  if (key === "sdf") return value >= SDF_INFINITE ? "∞" : `${value}×`;
  return `${round1(value)}F (${framesToMs(value)} ms)`;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Snap a slider value into its range and step. */
export function clampSlider(spec: SliderSpec, value: number): number {
  if (!Number.isFinite(value)) return spec.key === "sdf" && value > 0 ? SDF_INFINITE : spec.min;
  const stepped = Math.round(value / spec.step) * spec.step;
  return round1(Math.min(spec.max, Math.max(spec.min, stepped)));
}

/** Every code bound to more than one action (or twice to the same action), mapped to those actions. */
export function findConflicts(binds: Keybinds): Map<string, BindAction[]> {
  const byCode = new Map<string, BindAction[]>();
  for (const { action } of BIND_ACTIONS) {
    for (const code of binds[action]) {
      if (!code) continue;
      byCode.set(code, [...(byCode.get(code) ?? []), action]);
    }
  }
  for (const [code, actions] of byCode) if (actions.length < 2) byCode.delete(code);
  return byCode;
}

/** Map from KeyboardEvent.code to action. With conflicts, the first action in BIND_ACTIONS order wins. */
export function codeToAction(binds: Keybinds): Map<string, BindAction> {
  const map = new Map<string, BindAction>();
  for (const { action } of BIND_ACTIONS) {
    for (const code of binds[action]) if (code && !map.has(code)) map.set(code, action);
  }
  return map;
}

export function setBinding(binds: Keybinds, action: BindAction, slot: number, code: string | null): Keybinds {
  const next = structuredClone(binds) as Keybinds;
  next[action][slot] = code;
  return next;
}

// ---- persistence ---------------------------------------------------------

export const STORAGE_KEY = "tst-trainer:settings:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** Loads settings, falling back field by field to defaults for anything missing or invalid. */
export function loadSettings(storage: StorageLike | undefined = safeLocalStorage()): Settings {
  const s = defaultSettings();
  let raw: unknown;
  try {
    raw = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return s;
  }
  if (!raw || typeof raw !== "object") return s;
  const { handling, keybinds } = raw as Partial<Record<keyof Settings, Record<string, unknown>>>;

  if (handling && typeof handling === "object") {
    for (const spec of HANDLING_SLIDERS) {
      const v = handling[spec.key];
      if (typeof v === "number") s.handling[spec.key] = clampSlider(spec, v);
    }
    for (const t of HANDLING_TOGGLES) {
      const v = handling[t.key];
      if (typeof v === "boolean") s.handling[t.key] = v;
    }
  }
  if (keybinds && typeof keybinds === "object") {
    for (const { action } of BIND_ACTIONS) {
      const v = keybinds[action];
      if (Array.isArray(v) && v.length === BIND_SLOTS && v.every((c) => c === null || typeof c === "string")) {
        s.keybinds[action] = v as (string | null)[];
      }
    }
  }
  return s;
}

export function saveSettings(settings: Settings, storage: StorageLike | undefined = safeLocalStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked: settings still apply for this session.
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Human-readable key name for a KeyboardEvent.code. */
export function keyLabel(code: string | null): string {
  if (!code) return "[NOT SET]";
  const special: Record<string, string> = {
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Space: "SPACE",
    Escape: "ESC",
    ShiftLeft: "L-SHIFT",
    ShiftRight: "R-SHIFT",
    ControlLeft: "L-CTRL",
    ControlRight: "R-CTRL",
    AltLeft: "L-ALT",
    AltRight: "R-ALT",
    MetaLeft: "L-CMD",
    MetaRight: "R-CMD",
    Enter: "ENTER",
    Tab: "TAB",
  };
  if (special[code]) return special[code];
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `NUM ${code.slice(6)}`;
  return code.toUpperCase();
}
