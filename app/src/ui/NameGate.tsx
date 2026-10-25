import { useState } from "preact/hooks";

import { savedName } from "../session.ts";
import { Wordmark } from "./bits.tsx";

interface Props {
  room: string | null;
  onEnter: (name: string) => Promise<void>;
}

export function NameGate({ room, onEnter }: Props) {
  const [name, setName] = useState(savedName());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: Event) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Escribe un nombre para entrar.");
    setBusy(true);
    setError("");
    try {
      await onEnter(clean);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo entrar. Inténtalo otra vez.");
      setBusy(false);
    }
  };

  return (
    <main class="gate">
      <Wordmark />
      <p class="gate-lede">
        Compra el Malecón, cobra peaje en la Javier Prado y quiebra a tus patas. Hasta 8 jugadores, sin cuentas.
      </p>
      <form class="gate-form" onSubmit={submit}>
        <label htmlFor="name">¿Cómo te llamamos en la mesa?</label>
        <div class="gate-row">
          <input
            id="name"
            maxLength={20}
            placeholder="Ej. Chabuca"
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <button type="submit" class="primary" disabled={busy}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
        </div>
        {error && (
          <p role="alert" class="form-error">
            {error}
          </p>
        )}
        <p class="gate-note">
          {room ? `Vas a entrar a la mesa ${room}.` : "Te sentamos en una mesa que esté esperando jugadores."}
        </p>
      </form>
    </main>
  );
}
