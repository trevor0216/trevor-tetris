import { describe, expect, it } from "vitest";
import { SDF_INFINITE } from "../src/engine/handling";
import {
  DEFAULT_KEYBINDS,
  HANDLING_SLIDERS,
  STORAGE_KEY,
  clampSlider,
  codeToAction,
  defaultSettings,
  findConflicts,
  formatSlider,
  keyLabel,
  loadSettings,
  saveSettings,
  setBinding,
} from "../src/ui/settings";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const spec = (k: string) => HANDLING_SLIDERS.find((s) => s.key === k)!;

describe("handling readouts and ranges", () => {
  it("shows frames and ms, matching the spec's defaults", () => {
    expect(formatSlider("arr", 0)).toBe("0F (0 ms)");
    expect(formatSlider("das", 5.5)).toBe("5.5F (92 ms)");
    expect(formatSlider("dcd", 2)).toBe("2F (33 ms)");
    expect(formatSlider("sdf", 40)).toBe("40×");
    expect(formatSlider("sdf", SDF_INFINITE)).toBe("∞");
  });

  it("ranges and steps match the spec", () => {
    expect(spec("arr")).toMatchObject({ min: 0, max: 5, step: 0.1 });
    expect(spec("das")).toMatchObject({ min: 1, max: 20, step: 0.1 });
    expect(spec("dcd")).toMatchObject({ min: 0, max: 20, step: 0.1 });
    expect(spec("sdf")).toMatchObject({ min: 5, max: SDF_INFINITE });
  });

  it("clamps and snaps to the step", () => {
    expect(clampSlider(spec("das"), 0.2)).toBe(1);
    expect(clampSlider(spec("das"), 5.54)).toBe(5.5);
    expect(clampSlider(spec("arr"), 9)).toBe(5);
    expect(clampSlider(spec("sdf"), Infinity)).toBe(SDF_INFINITE);
  });
});

describe("persistence", () => {
  it("round-trips through storage", () => {
    const st = memoryStorage();
    const s = defaultSettings();
    s.handling.das = 7.2;
    s.handling.sdf = SDF_INFINITE;
    s.keybinds.hardDrop = ["Space", "KeyW", null];
    saveSettings(s, st);
    expect(loadSettings(st)).toEqual(s);
  });

  it("falls back to defaults for missing, corrupt or invalid data", () => {
    expect(loadSettings(memoryStorage())).toEqual(defaultSettings());
    expect(loadSettings(memoryStorage({ [STORAGE_KEY]: "{not json" }))).toEqual(defaultSettings());
    const partial = loadSettings(
      memoryStorage({
        [STORAGE_KEY]: JSON.stringify({ handling: { das: 99, arr: "fast", preferSoftDrop: false }, keybinds: { hold: ["KeyA"] } }),
      }),
    );
    expect(partial.handling.das).toBe(20); // clamped
    expect(partial.handling.arr).toBe(0); // invalid type → default
    expect(partial.handling.preferSoftDrop).toBe(false);
    expect(partial.keybinds.hold).toEqual(DEFAULT_KEYBINDS.hold); // wrong slot count → default
  });
});

describe("keybinds", () => {
  it("defaults match the spec, one key per action", () => {
    const first = Object.fromEntries(Object.entries(DEFAULT_KEYBINDS).map(([a, v]) => [a, v[0]]));
    expect(first).toEqual({
      moveLeft: "ArrowLeft",
      moveRight: "ArrowRight",
      softDrop: "ArrowDown",
      hardDrop: "Space",
      rotateCCW: "KeyZ",
      rotateCW: "ArrowUp",
      rotate180: "KeyX",
      hold: "KeyC",
      forfeit: "Escape",
      restart: "KeyR",
    });
    expect(findConflicts(DEFAULT_KEYBINDS as never).size).toBe(0);
  });

  it("detects conflicts across actions and duplicate slots", () => {
    let b = setBinding(DEFAULT_KEYBINDS as never, "hold", 1, "KeyZ");
    expect(findConflicts(b).get("KeyZ")).toEqual(["rotateCCW", "hold"]);
    b = setBinding(DEFAULT_KEYBINDS as never, "hold", 1, "KeyC");
    expect(findConflicts(b).get("KeyC")).toEqual(["hold", "hold"]);
  });

  it("clearing a slot unbinds it", () => {
    const b = setBinding(DEFAULT_KEYBINDS as never, "hold", 0, null);
    expect(codeToAction(b).has("KeyC")).toBe(false);
    expect(keyLabel(null)).toBe("[NOT SET]");
  });

  it("setBinding doesn't mutate its input", () => {
    setBinding(DEFAULT_KEYBINDS as never, "hold", 0, "KeyQ");
    expect(DEFAULT_KEYBINDS.hold[0]).toBe("KeyC");
  });

  it("labels keys readably", () => {
    expect(keyLabel("KeyZ")).toBe("Z");
    expect(keyLabel("ArrowLeft")).toBe("←");
    expect(keyLabel("Space")).toBe("SPACE");
    expect(keyLabel("Digit3")).toBe("3");
  });
});
