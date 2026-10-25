import "@fontsource-variable/bricolage-grotesque/standard.css";
import "./styles.css";
import { render } from "preact";

import { App } from "./App.tsx";
import { unlockAudio } from "./audio.ts";

// Browsers allow sound only after the first interaction.
for (const type of ["pointerdown", "keydown"]) addEventListener(type, unlockAudio, { once: true, capture: true });

const root = document.getElementById("app");
if (root) render(<App />, root);
