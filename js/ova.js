// Renders $math$ and **bold** on the public practice pages (/ova/...). The server writes that text
// escaped into [data-rich] elements; this swaps in the same rendering the app uses. KaTeX is a
// deferred classic script, which the browser runs before this module.
import { renderRich } from "./lib/rich.js";

for (const node of document.querySelectorAll("[data-rich]")) {
  node.innerHTML = renderRich(node.textContent);
}
