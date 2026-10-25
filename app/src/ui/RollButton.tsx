interface Props {
  label: string;
  onRoll: () => void;
  disabled: boolean;
}

export function RollButton({ label, onRoll, disabled }: Props) {
  return (
    <button type="button" class="roll" onClick={onRoll} disabled={disabled}>
      {label}
      <span class="roll-hint">Tiro automático</span>
    </button>
  );
}
