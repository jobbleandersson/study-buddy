// The name next to the logo, set the same everywhere it appears (sidebar, top bar, front page, sign-in page, footer, the
// welcome screen, the profile card): "Plugg" in the text colour and "Era" in the brand blue. One place, so the wordmark
// changes in one place. The two parts are one word to a screen reader.

import { el } from "./dom.js";

export const wordmarkText = () => el("span.wordmark__text", {}, ["Plugg", el("b", {}, "Era")]);
