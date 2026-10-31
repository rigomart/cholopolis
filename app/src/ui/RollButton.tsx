interface Props {
  label: string;
  onRoll: () => void;
  disabled: boolean;
}

export function RollButton({ label, onRoll, disabled }: Props) {
  return (
    <button type="button" class="roll primary big" onClick={onRoll} disabled={disabled}>
      {label}
      <span class="roll-hint">o agarra los dados</span>
    </button>
  );
}
