// Runs before first paint: sets the theme/font/language attributes <html> needs so there's no
// flash of the wrong one, and finishes wiring up the KaTeX stylesheet's media-swap trick. A plain
// external script rather than the inline <script> (and inline onload="") this used to be — moving
// both out lets index.html ship a Content-Security-Policy with no 'unsafe-inline' in script-src.
(function () {
  var root = document.documentElement;
  try {
    var t = localStorage.getItem("studybuddy.theme");
    root.setAttribute("data-theme", ["light", "paper", "dark", "system"].indexOf(t) >= 0 ? t : "system");
  } catch (e) {
    root.setAttribute("data-theme", "system");
  }
  try {
    var f = localStorage.getItem("studybuddy.font");
    root.setAttribute("data-font", f === "hyperlegible" ? "hyperlegible" : "system");
    var sz = localStorage.getItem("studybuddy.textSize");
    root.setAttribute("data-textsize", ["s", "m", "l"].indexOf(sz) >= 0 ? sz : "m");
  } catch (e) {
    root.setAttribute("data-font", "system");
    root.setAttribute("data-textsize", "m");
  }
  try {
    var supported = ["en", "sv"];
    var l = localStorage.getItem("studybuddy.lang");
    // Every bundled set is Swedish curriculum content, so that's the
    // default when the student hasn't chosen — not a browser-language guess.
    root.setAttribute("lang", supported.indexOf(l) >= 0 ? l : "sv");
  } catch (e) {
    root.setAttribute("lang", "sv");
  }

  // The KaTeX stylesheet loads with media="print" so the browser fetches it at normal priority
  // without blocking first paint on it; flipping it to "all" the moment it's actually in means
  // it's already applied by the time any page that renders math needs it. See index.html.
  // This script runs after the <link> is parsed, so from a warm cache the stylesheet can already have
  // loaded - its "load" event fired before the listener existed, and waiting for it would leave the
  // sheet on media="print" for good (math unstyled on screen). A present .sheet means it's already in.
  var katexLink = document.getElementById("katex-print-css");
  if (katexLink) {
    if (katexLink.sheet) katexLink.media = "all";
    else katexLink.addEventListener("load", function () { katexLink.media = "all"; });
  }

  // The rest is for the app itself (index.html), not the public practice pages that share this file.
  if (!root.hasAttribute("data-app")) return;
  var lang = root.getAttribute("lang");

  // The UI strings for that language, requested now: lib/i18n.js loads them with a dynamic import,
  // which the browser would otherwise only start once every other module had downloaded. Browsers
  // without modulepreload (Safari before 17) get the same request as a plain preload.
  var pre = document.createElement("link");
  var modulePreload = pre.relList && pre.relList.supports && pre.relList.supports("modulepreload");
  pre.rel = modulePreload ? "modulepreload" : "preload";
  if (!modulePreload) { pre.as = "script"; pre.crossOrigin = "anonymous"; }
  pre.href = "js/lib/strings." + lang + ".js";
  document.head.appendChild(pre);

  // If the app can't start (a module that didn't download, or a browser too old to read it, such
  // as iOS 14), say so instead of leaving a blank page. main.js sets __sbStarted as soon as all
  // its modules are in; from then on errors are the error reporter's (lib/error-report.js).
  var shown = false;
  var modern = (function () { try { return "cause" in new Error("", { cause: 1 }); } catch (x) { return false; } })();
  function bootFailed(oldBrowser) {
    var app = document.getElementById("app");
    if (window.__sbStarted || shown || !app) return;
    shown = true;
    var sv = lang !== "en";
    var box = document.createElement("div");
    box.className = "boot-failed";
    var h = document.createElement("h1");
    h.textContent = oldBrowser
      ? (sv ? "Webbläsaren är för gammal" : "This browser is too old")
      : (sv ? "PluggEra kunde inte starta" : "PluggEra couldn't start");
    var p = document.createElement("p");
    p.textContent = oldBrowser
      ? (sv ? "PluggEra fungerar inte i den här versionen. Uppdatera webbläsaren (på iPhone: iOS 15 eller senare) och öppna sidan igen."
            : "PluggEra doesn't work in this version. Update the browser (on iPhone: iOS 15 or later) and open the page again.")
      : (sv ? "En del av appen laddades inte. Kontrollera anslutningen och ladda om sidan."
            : "Part of the app didn't load. Check your connection and reload the page.");
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = sv ? "Ladda om" : "Reload";
    b.addEventListener("click", function () { location.reload(); });
    box.appendChild(h); box.appendChild(p); box.appendChild(b);
    app.textContent = "";
    app.appendChild(box);
  }
  window.addEventListener("error", function (e) {
    if (window.__sbStarted) return;
    var el = e.target;
    // A module script that failed to download (its own file or one it imports).
    if (el && el.tagName === "SCRIPT" && el.type === "module") return bootFailed(false);
    // Thrown while the modules load: only the app's own files (/js/), not extensions or vendor scripts.
    if (!/\/js\//.test(e.filename || "")) return;
    // A syntax error in a browser that has the features this app needs is a broken file, not an old
    // browser. (Error causes came in the same releases as top-level await: Safari 15, Chrome 93.)
    if (e.error instanceof SyntaxError) return bootFailed(!modern);
    if (/import/i.test(e.message || "")) bootFailed(false);   // a dynamic import, e.g. the strings
  }, true);
})();
