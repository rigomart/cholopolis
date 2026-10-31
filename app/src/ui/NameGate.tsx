import { useEffect, useState } from "preact/hooks";

import { parseRoomCode, roomExists, savedName } from "../session.ts";
import { Wordmark } from "./bits.tsx";
import { RankingSheet } from "./Ranking.tsx";

interface Props {
  room: string | null;
  /** `code` is null to be seated wherever there's room. */
  onEnter: (name: string, code: string | null) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
}

interface Problem {
  field?: "name" | "code";
  message: string;
}

export function NameGate({ room, onEnter, onCreate }: Props) {
  const [name, setName] = useState(savedName());
  const [code, setCode] = useState(room ?? "");
  const [busy, setBusy] = useState<"enter" | "create" | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [rankingOpen, setRankingOpen] = useState(false);

  useEffect(() => {
    setCode(room ?? "");
    setProblem(null);
  }, [room]);

  const target = parseRoomCode(code);

  const run = async (kind: "enter" | "create", go: (name: string) => Promise<boolean | void>) => {
    const clean = name.trim();
    if (!clean) return setProblem({ field: "name", message: "Escribe un nombre para entrar." });
    setBusy(kind);
    setProblem(null);
    try {
      if ((await go(clean)) === false) return setBusy(null);
    } catch (err) {
      setProblem({ message: err instanceof Error ? err.message : "No se pudo entrar. Inténtalo otra vez." });
      setBusy(null);
    }
  };

  const enter = (e: Event) => {
    e.preventDefault();
    if (code.trim() && !target) {
      return setProblem({
        field: "code",
        message: "Ese código no parece de una mesa. Son entre 6 y 12 letras y números, o pega el enlace.",
      });
    }
    return run("enter", async (clean) => {
      if (target && !(await roomExists(target))) {
        setProblem({ field: "code", message: "No encontramos esa mesa. Revisa el código o crea una mesa nueva." });
        return false;
      }
      await onEnter(clean, target);
    });
  };

  return (
    <>
      <main class="gate">
        <Wordmark />
        <p class="gate-lede">
          Compra el Malecón, cobra peaje en la Javier Prado y quiebra a tus patas. Hasta 8 jugadores, sin cuentas.
        </p>
        <form class="gate-form" onSubmit={enter}>
          <div class="gate-fields">
            <div>
              <label htmlFor="name">Tu nombre</label>
              <input
                id="name"
                maxLength={20}
                placeholder="Ej. Chabuca"
                value={name}
                readOnly={busy !== null}
                aria-invalid={problem?.field === "name"}
                onInput={(e) => {
                  setName(e.currentTarget.value);
                  if (problem?.field === "name") setProblem(null);
                }}
              />
            </div>
            <div>
              <label htmlFor="code">Código de mesa (opcional)</label>
              <input
                id="code"
                placeholder="Código o enlace"
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellcheck={false}
                value={code}
                readOnly={busy !== null}
                aria-invalid={problem?.field === "code"}
                onInput={(e) => {
                  setCode(e.currentTarget.value);
                  if (problem?.field === "code") setProblem(null);
                }}
              />
            </div>
          </div>
          <div class="gate-actions">
            <button type="submit" class="primary" disabled={busy !== null}>
              {busy === "enter" ? "Entrando…" : "Entrar"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => run("create", onCreate)}>
              {busy === "create" ? "Creando…" : "Crear mesa nueva"}
            </button>
          </div>
          {problem && (
            <p role="alert" class="form-error">
              {problem.message}
            </p>
          )}
          {target && problem?.field !== "code" && <p class="gate-note">Entrarás a la mesa {target}.</p>}
        </form>
        <button type="button" class="link gate-ranking" onClick={() => setRankingOpen(true)}>
          Ranking 🏆
        </button>
      </main>
      {rankingOpen && <RankingSheet onClose={() => setRankingOpen(false)} />}
    </>
  );
}
