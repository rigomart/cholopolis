import { useState } from "preact/hooks";

interface Props {
  label: string;
  onShake: (on: boolean) => void;
  onRoll: () => void;
}

/**
 * Press and hold to "revolver los dados", release to throw. A quick click still rolls: the dice
 * just get a short shake. Space and Enter work the same way from the keyboard.
 */
const isKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";

export function RollButton({ label, onShake, onRoll }: Props) {
  const [holding, setHolding] = useState(false);
  const start = () => {
    if (holding) return;
    setHolding(true);
    onShake(true);
  };
  const release = () => {
    if (!holding) return;
    setHolding(false);
    onRoll();
  };
  const cancel = () => {
    if (!holding) return;
    setHolding(false);
    onShake(false);
  };

  return (
    <button
      type="button"
      class="primary big roll"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={release}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        release();
      }}
      onBlur={cancel}
      // Assistive tech can "click" without pointer or key events.
      onClick={(e) => {
        if (e.detail === 0 && !holding) onRoll();
      }}
    >
      {label}
      <span class="roll-hint">Mantén para revolver, suelta para tirar</span>
    </button>
  );
}
