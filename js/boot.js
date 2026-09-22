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
  var katexLink = document.getElementById("katex-print-css");
  if (katexLink) katexLink.addEventListener("load", function () { katexLink.media = "all"; });
})();
