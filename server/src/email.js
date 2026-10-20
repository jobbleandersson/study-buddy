// Transactional email — verification links, password resets. Off by default, like Google sign-in
// (see google.js): with no RESEND_API_KEY, emailEnabled() is false, nothing here is ever called,
// and signup/login behave exactly as they did before this file existed. Set the key to turn it on.
//
// Resend (https://resend.com) is the one provider wired up: a single HTTPS call, no SDK. Swapping
// providers later means changing sendEmail() below — nothing that calls it needs to know how.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "PluggEra <onboarding@resend.dev>";
// Overridable so tests can point the real send path at a local fake instead of api.resend.com.
const RESEND_API_URL = process.env.RESEND_API_URL || "https://api.resend.com/emails";

export function emailEnabled() {
  return !!RESEND_API_KEY;
}

// Resend's free tier is 100 emails/day, and sign-in codes now ride on it: if unauthenticated
// routes (forgot-password, signup verification) could burn the whole day's quota, every account
// with email 2FA would be locked out of signing in. So the quota is split by kind, and each kind
// has its own share, so a flood of one cannot starve another: `low` mail (signup verification, the
// contact form, the welcome mail — anyone can trigger them in bulk) may use 30% of the daily budget,
// ordinary mail (password resets) 35%, and `critical` mail (sign-in codes) may use whatever is left
// of the whole budget, at least 35%. (They used to share one counter, so 40 verification mails left
// room for only 20 resets.) In-memory, per process, resets at UTC midnight and on restart — like
// every limiter here. EMAIL_DAILY_BUDGET=0 switches it off. mailLimits.js limits who can be mailed.
const DAILY_BUDGET = (() => {
  const n = Number(process.env.EMAIL_DAILY_BUDGET);
  return Number.isFinite(n) && n >= 0 && process.env.EMAIL_DAILY_BUDGET?.trim() ? n : 100;
})();
let budgetDay = "";
const used = { low: 0, ordinary: 0, critical: 0 };
const SHARE = { low: 0.3, ordinary: 0.35 };   // of the daily budget; critical has no share of its own
function takeBudget(critical, low) {
  if (!(DAILY_BUDGET > 0)) return true;
  const day = new Date().toISOString().slice(0, 10);
  if (day !== budgetDay) { budgetDay = day; used.low = used.ordinary = used.critical = 0; }
  const kind = critical ? "critical" : low ? "low" : "ordinary";
  const total = used.low + used.ordinary + used.critical;
  const full = total >= DAILY_BUDGET || (kind !== "critical" && used[kind] >= Math.floor(DAILY_BUDGET * SHARE[kind]));
  if (full) { console.warn("[email] daily budget reached", { kind, used: { ...used } }); return false; }
  used[kind]++;
  return true;
}

/** Best-effort: returns false (and logs) on any failure rather than throwing, so a flaky provider
 *  never turns into a 500 on signup or password reset — the token is already stored either way,
 *  and resend-verification exists for exactly this case. */
export async function sendEmail({ to, subject, html, critical = false, low = false, replyTo = null }) {
  if (!RESEND_API_KEY) return false;
  if (!takeBudget(critical, low)) return false;
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[email] send failed", res.status, await res.text().catch(() => ""));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] send error", e);
    return false;
  }
}

// PUBLIC_URL anchors the links inside an email — a relative path means nothing outside the app,
// and this server doesn't reliably know its own public origin (Fly, a custom domain, localhost
// all differ). Falls back to localhost so a dev run without it set still prints something sane
// to the console instead of an undefined-looking link.
const PUBLIC_URL = (process.env.PUBLIC_URL || "http://localhost:8787").replace(/\/+$/, "");

function layout(bodyHtml, footer = "Om du inte bad om det här kan du bortse från mejlet. · If you didn't request this, you can ignore this email.") {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#191D28">
    <h1 style="font-size:20px;margin:0 0 16px">PluggEra</h1>
    ${bodyHtml}
    <p style="font-size:12px;color:#6B7386;margin-top:32px">${footer}</p>
  </div>`;
}

/** Once per new account: right away for a Google sign-up, after the address is confirmed for an
 *  email sign-up (so a new user never gets two mails at once, and nothing goes to an address that
 *  was never proven). The server doesn't know the student's language, so it's Swedish first with
 *  English below. `low`, like the verification mail: a welcome can be skipped, a sign-in code can't. */
export function sendWelcomeEmail(to) {
  const btn = (href, label) => `<a href="${href}" style="display:inline-block;background:#2C5CD6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${label}</a>`;
  const li = 'style="margin:0 0 6px"';
  return sendEmail({
    to, low: true, subject: "Välkommen till PluggEra",
    html: layout(`
      <p style="font-size:16px;margin:0 0 12px"><strong>Välkommen!</strong> Ditt konto är klart.</p>
      <p style="margin:0 0 8px">Tre bra ställen att börja på:</p>
      <ul style="margin:0 0 16px;padding-left:20px">
        <li ${li}><a href="${PUBLIC_URL}/#/create" style="color:#2C5CD6">Skapa</a> – gör ett övningsset av dina egna anteckningar eller uppgifter.</li>
        <li ${li}><a href="${PUBLIC_URL}/#/hp" style="color:#2C5CD6">Högskoleprovet</a> – öva varje delprov i provformat och få en uppskattad poäng.</li>
        <li ${li}>Repetition – frågor du missar kommer tillbaka lagom tills du kan dem.</li>
      </ul>
      <p style="margin:0 0 24px">${btn(`${PUBLIC_URL}/`, "Öppna PluggEra")}</p>
      <hr style="border:0;border-top:1px solid #E3E6EE;margin:0 0 16px">
      <p style="font-size:14px;color:#3A4152;margin:0 0 8px"><strong>Welcome!</strong> Your account is ready. Make a practice set from your own notes under
        <a href="${PUBLIC_URL}/#/create" style="color:#2C5CD6">Create</a>, practise the Swedish Högskoleprovet under
        <a href="${PUBLIC_URL}/#/hp" style="color:#2C5CD6">Högskoleprovet</a>, and the questions you miss come back for review until you know them.</p>
    `, "Du får det här mejlet för att ett konto skapades på PluggEra med den här adressen. · You're getting this because a PluggEra account was created with this address."),
  });
}

// The mails below go to students and parents, and the server does not know whose language to use (a reset or a
// code is asked for before anyone is signed in), so each one is Swedish first with English under it, as the
// welcome mail is. Subjects carry both too. Links and codes appear once, above the text.
const both = (sv, en) => `${sv}<hr style="border:0;border-top:1px solid #E3E6EE;margin:20px 0"><div lang="en" style="color:#3A4152">${en}</div>`;
const subj = (sv, en) => `${sv} · ${en}`;
const FOOT = "Om du inte bad om det här kan du bortse från mejlet. · If you didn't request this, you can ignore this email.";
const button = (href, label) => `<p><a href="${href}" style="display:inline-block;background:#2C5CD6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">${label}</a></p>`;
const small = (html) => `<p style="font-size:13px;color:#6B7386">${html}</p>`;

export function sendVerifyEmail(to, token) {
  const url = `${PUBLIC_URL}/#/verify?token=${token}`;
  return sendEmail({
    to, low: true, subject: subj("Bekräfta din e-post för PluggEra", "Confirm your email for PluggEra"),
    html: layout(`
      ${button(url, "Bekräfta e-post · Confirm email")}
      ${small(url)}
      ${both(
        `<p>Tryck på knappen för att bekräfta att det här är din e-postadress.</p>${small("Länken fungerar i 24 timmar.")}`,
        `<p>Tap the button to confirm this is your email address.</p>${small("This link works for 24 hours.")}`)}
    `, FOOT),
  });
}

export function sendResetEmail(to, token) {
  const url = `${PUBLIC_URL}/#/reset?token=${token}`;
  return sendEmail({
    to, subject: subj("Återställ ditt lösenord på PluggEra", "Reset your PluggEra password"),
    html: layout(`
      ${button(url, "Återställ lösenord · Reset password")}
      ${small(url)}
      ${both(
        `<p>Någon bad om att få lösenordet till det här PluggEra-kontot återställt. Tryck på knappen för att välja ett nytt.</p>${small("Länken fungerar i 1 timme. Ditt nuvarande lösenord gäller tills du använder den.")}`,
        `<p>Someone asked to reset the password for this PluggEra account. Tap the button to set a new one.</p>${small("This link works for 1 hour. Your current password still works until you use it.")}`)}
    `, FOOT),
  });
}

// Best-effort notice for a security-relevant change made with an already-signed-in session, so
// the account owner finds out even if it wasn't them (a stolen session cookie, say).
export function sendTwoFaEnabledEmail(to) {
  return sendEmail({
    to, subject: subj("Tvåstegsverifiering påslagen", "Two-factor authentication turned on"),
    html: layout(both(
      `<p>Tvåstegsverifiering slogs just på för det här PluggEra-kontot. Från nu behöver du en kod från din autentiseringsapp utöver lösenordet för att logga in.</p>${small("Om det inte var du: logga in, stäng av det under Inställningar och byt lösenord.")}`,
      `<p>Two-factor authentication was just turned on for this PluggEra account. From now on, signing in needs a code from your authenticator app as well as your password.</p>${small("If this wasn't you, sign in and turn it off again from Settings, then change your password.")}`), FOOT),
  });
}

export function sendTwoFaDisabledEmail(to) {
  return sendEmail({
    to, subject: subj("Tvåstegsverifiering avstängd", "Two-factor authentication turned off"),
    html: layout(both(
      `<p>Tvåstegsverifiering stängdes just av för det här PluggEra-kontot. Nu räcker lösenordet för att logga in.</p>${small("Om det inte var du: logga in, slå på det igen under Inställningar och byt lösenord.")}`,
      `<p>Two-factor authentication was just turned off for this PluggEra account. Signing in now only needs your password.</p>${small("If this wasn't you, sign in, turn it back on from Settings, and change your password.")}`), FOOT),
  });
}

// The sign-in / enrolment code. The code is deliberately NOT in the subject: subjects show on lock
// screens and in notification previews. `critical` lets it use the quota reserve (see takeBudget).
export function sendTwoFaCodeEmail(to, code, purpose) {
  const enroll = purpose === "enroll";
  return sendEmail({
    // Only sign-in codes may use the reserve: turning 2FA on can wait, and an account that turns
    // it on over and over must not be able to spend the codes everyone else needs to sign in.
    to, critical: !enroll, subject: subj("Din verifieringskod för PluggEra", "Your PluggEra verification code"),
    html: layout(`
      <p>${enroll ? "Din kod för att slå på tvåstegsverifiering · Your code to turn on two-factor authentication" : "Din kod för att logga in · Your code to sign in"}:</p>
      <p style="font-size:30px;letter-spacing:6px;font-weight:700;margin:12px 0">${code}</p>
      ${both(
        small("Koden fungerar i 10 minuter. Om det inte var du som försökte kan någon ha ditt lösenord: byt det, och dela inte koden med någon."),
        small("It works for 10 minutes. If you didn't just try this, someone may have your password: change it, and don't share this code with anyone."))}
    `, FOOT),
  });
}

export function sendEmailChangeConfirmEmail(to, token) {
  const url = `${PUBLIC_URL}/#/new-email?token=${token}`;
  return sendEmail({
    to, low: true, subject: subj("Bekräfta din nya e-post för PluggEra", "Confirm your new email for PluggEra"),
    html: layout(`
      ${button(url, "Bekräfta ny e-post · Confirm new email")}
      ${small(url)}
      ${both(
        `<p>Någon bad om att få använda den här adressen för att logga in på ett PluggEra-konto. Tryck på knappen för att bekräfta att den är din. Tills du gör det ändras ingenting.</p>${small("Länken fungerar i 1 timme. När du bekräftar loggas kontot ut på alla andra enheter.")}`,
        `<p>Someone asked to use this address to sign in to a PluggEra account. Tap the button to confirm it is yours. Until you do, nothing changes.</p>${small("This link works for 1 hour. Confirming signs the account out on every other device.")}`)}
    `, FOOT),
  });
}

// To the OLD address when a change is asked for, and again when it happens: the person who owns the
// account finds out even if it was not them.
export function sendEmailChangeRequestedEmail(to, newEmail) {
  const a = escapeHtml(newEmail);
  return sendEmail({
    to, subject: subj("En ny e-postadress har begärts för ditt PluggEra-konto", "A new email address was requested for your PluggEra account"),
    html: layout(both(
      `<p>Någon som var inloggad med ditt lösenord bad om att byta e-postadress för det här PluggEra-kontot till <b>${a}</b>. Ingenting ändras förrän den adressen har bekräftats.</p>${small("Om det inte var du: använd ”Glömt lösenord” på inloggningssidan och välj ett nytt lösenord. Då avbryts begäran också.")}`,
      `<p>Someone, signed in with your password, asked to change this PluggEra account's email address to <b>${a}</b>. Nothing changes until that address is confirmed.</p>${small("If this wasn't you, use ‘Forgot password’ on the sign-in page to set a new password: that also cancels the request.")}`), FOOT),
  });
}

export function sendEmailChangedEmail(to, newEmail) {
  const a = escapeHtml(newEmail);
  return sendEmail({
    to, subject: subj("Din e-postadress på PluggEra har ändrats", "Your PluggEra email address was changed"),
    html: layout(both(
      `<p>E-postadressen för det här PluggEra-kontot ändrades just till <b>${a}</b>, och alla andra enheter loggades ut. Logga in med den nya adressen framöver.</p>${small("Om det inte var du: skriv till oss från den här adressen så snart du kan.")}`,
      `<p>The email address of this PluggEra account was just changed to <b>${a}</b>, and every other device was signed out. Sign in with the new address from now on.</p>${small("If this wasn't you, write to us from this address as soon as you can.")}`), FOOT),
  });
}

export function sendPasswordChangedEmail(to) {
  return sendEmail({
    to, subject: subj("Ditt lösenord på PluggEra har ändrats", "Your PluggEra password was changed"),
    html: layout(both(
      `<p>Lösenordet för det här PluggEra-kontot ändrades just, och alla andra enheter loggades ut.</p>${small("Om det inte var du: använd ”Glömt lösenord” på inloggningssidan och välj ett nytt.")}`,
      `<p>The password for this PluggEra account was just changed, and every other device was signed out.</p>${small("If this wasn't you, use ‘Forgot password’ on the sign-in page to set a new one.")}`), FOOT),
  });
}

// Someone asked to reset the password of an address whose account signs in with Google and has no password.
export function sendUseGoogleEmail(to) {
  return sendEmail({
    to, low: true, subject: subj("Logga in på PluggEra med Google", "Sign in to PluggEra with Google"),
    html: layout(both(
      `<p>Någon bad om att få lösenordet för den här adressen återställt. PluggEra-kontot för den loggar in med Google och har inget lösenord att återställa: välj ”Logga in med Google” på inloggningssidan.</p>${small("Vill du ha ett lösenord också? Logga in med Google, öppna Inställningar och lägg till ett. Om det inte var du kan du bortse från det här mejlet.")}`,
      `<p>Someone asked to reset the password for this address. The PluggEra account for it signs in with Google and has no password to reset: choose ‘Sign in with Google’ on the sign-in page.</p>${small("Want a password as well? Sign in with Google, open Settings and choose to add one. If this wasn't you, you can ignore this email.")}`), FOOT),
  });
}

// An existing password account was linked to Google: the password was turned off.
export function sendGoogleLinkedEmail(to) {
  return sendEmail({
    to, low: true, subject: subj("Ditt PluggEra-konto loggar nu in med Google", "Your PluggEra account now signs in with Google"),
    html: layout(both(
      `<p>Det här PluggEra-kontot kopplades just till en Google-inloggning. Det gamla lösenordet fungerar inte längre och alla enheter loggades ut: logga in med Google framöver.</p>${small("Vill du ha ett lösenord också? Logga in med Google, öppna Inställningar och lägg till ett. Om det inte var du: logga in med Google och kontrollera ditt konto.")}`,
      `<p>This PluggEra account was just linked to a Google sign-in. Its old password no longer works and every device was signed out: sign in with Google from now on.</p>${small("Want a password as well? Sign in with Google, open Settings and choose to add one. If this wasn't you, sign in with Google to check your account.")}`), FOOT),
  });
}

export function sendPasswordAddedEmail(to) {
  return sendEmail({
    to, subject: subj("Ett lösenord lades till på ditt PluggEra-konto", "A password was added to your PluggEra account"),
    html: layout(both(
      `<p>Ett lösenord lades just till på det här PluggEra-kontot, bekräftat via din Google-inloggning. Framöver kan du logga in med Google eller med e-post och det här lösenordet.</p>${small("Om det inte var du: logga in med Google och kontrollera ditt konto. Den som gjorde det skulle behöva din Google-inloggning för att göra om det.")}`,
      `<p>A password was just added to this PluggEra account, confirmed through your Google sign-in. From now on you can sign in either with Google or with your email and this password.</p>${small("If this wasn't you, sign in with Google to check your account: whoever did this would need your Google sign-in to do it again.")}`), FOOT),
  });
}

// Where the contact form (#/contact, routes/contact.js) delivers. The client shows the same address
// for anyone who'd rather write from their own mail app — keep it in step with js/config.js.
export const CONTACT_TO = process.env.CONTACT_TO || "pluggera.organisation@gmail.com";

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Who hears that the AI is down (ai-check.js). `critical`: rare, and it must not be the mail the daily
// budget drops on a busy day.
const ALERT_TO = () => process.env.ALERT_EMAIL || CONTACT_TO;
const AI_FIX = {
  no_key: ["Servern har ingen API-nyckel (ANTHROPIC_API_KEY är tom eller saknas).", "Sätt nyckeln igen: fly secrets set ANTHROPIC_API_KEY=… -a studybuddy-jobble"],
  key_rejected: ["Anthropic nekar nyckeln — den har gått ut eller tagits bort.", "Skapa en ny nyckel i Anthropic Console (API keys) och sätt den med fly secrets set ANTHROPIC_API_KEY=… -a studybuddy-jobble"],
  no_credit: ["Anthropic-kontot har slut på kredit.", "Fyll på under Billing i Anthropic Console."],
  upstream_error: ["Anthropic svarar med ett fel just nu.", "Oftast tillfälligt. Kolla status.anthropic.com; håller det i sig, kolla serverns loggar (fly logs)."],
  unreachable: ["Servern når inte Anthropic.", "Oftast tillfälligt. Kolla status.anthropic.com och fly logs."],
};

export function sendAiAlertEmail(reason) {
  const [what, fix] = AI_FIX[reason] || AI_FIX.upstream_error;
  return sendEmail({
    to: ALERT_TO(), critical: true, subject: "PluggEra: AI-funktionerna fungerar inte",
    html: layout(`
      <p><strong>AI:n i PluggEra svarar inte.</strong> Handledaren, att skapa set, AI-skrivna HP-frågor och rättning av fritextsvar fungerar inte för eleverna just nu.</p>
      <p><strong>Orsak:</strong> ${escapeHtml(what)}</p>
      <p><strong>Så åtgärdar du det:</strong> ${escapeHtml(fix)}</p>
      <p style="font-size:13px;color:#6B7386">Kontrollerat två gånger med två minuters mellanrum (kod: ${escapeHtml(reason)}). Du får ett nytt mejl när det fungerar igen, och en påminnelse om dagen så länge det inte gör det. Status just nu: ${PUBLIC_URL}/api/health/ai</p>
    `, "Automatisk kontroll från PluggEras server."),
  });
}

/** A student has sent (or changed) a review: nothing shows on the front page until it's approved at
 *  #/admin/reviews, so this is the nudge to go and look. Only what the student chose to publish
 *  (their display name, optional description, text, stars) — no email address, no account id. Ordinary
 *  mail, not critical: a review can wait, a sign-in code can't. */
export function sendNewReviewEmail({ rating, name, context, lang, text, updated = false }) {
  const stars = "★".repeat(rating) + "☆".repeat(5 - rating);
  return sendEmail({
    to: ALERT_TO(),
    subject: `PluggEra: ${updated ? "ändrad recension" : "ny recension"} att granska (${rating}/5)`,
    html: layout(`
      <p><strong>${updated ? "En elev har ändrat sin recension" : "En elev har skrivit en recension"}.</strong> Den visas inte på startsidan förrän du godkänner den.</p>
      <p style="font-size:22px;letter-spacing:2px;margin:12px 0;color:#2C5CD6">${stars}</p>
      <blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid #C8CDDA;background:#F4F6FB;white-space:pre-wrap">${escapeHtml(text)}</blockquote>
      <p style="font-size:14px;color:#3A4254"><strong>${escapeHtml(name)}</strong>${context ? ` · ${escapeHtml(context)}` : ""} · skriven på ${lang === "en" ? "engelska" : "svenska"}</p>
      <p><a href="${PUBLIC_URL}/#/admin/reviews" style="display:inline-block;padding:10px 16px;background:#2C5CD6;color:#fff;border-radius:8px;text-decoration:none">Granska recensionen</a></p>
    `, "Automatiskt mejl från PluggEras server."),
  });
}

/** A student reported an AI answer (routes/ai-reports.js). The answer, what they asked and why - never who
 *  they are. Everything in it came from a student or the model, so all of it is escaped. */
export function sendNewAiReportEmail({ where, reason, note = "", content, prompt = "" }) {
  const reasonSv = { wrong: "svaret är fel", harmful: "olämpligt eller stötande", other: "något annat" }[reason] || reason;
  const whereSv = where === "solve" ? "PluggEra AI" : "handledaren i ett pass";
  const quote = (s) => `<blockquote style="margin:0 0 12px;padding:10px 14px;border-left:3px solid #C8CDDA;background:#F4F6FB;white-space:pre-wrap">${escapeHtml(s)}</blockquote>`;
  return sendEmail({
    to: ALERT_TO(),
    subject: `PluggEra: ett AI-svar har rapporterats (${reasonSv})`,
    html: layout(`
      <p><strong>En elev har rapporterat ett svar från ${escapeHtml(whereSv)}.</strong> Skäl: ${escapeHtml(reasonSv)}.</p>
      ${note ? `<p style="font-size:14px;color:#3A4254"><strong>Elevens kommentar:</strong></p>${quote(note)}` : ""}
      ${prompt ? `<p style="font-size:14px;color:#3A4254"><strong>Eleven hade skrivit:</strong></p>${quote(prompt)}` : ""}
      <p style="font-size:14px;color:#3A4254"><strong>AI:ns svar:</strong></p>
      ${quote(content)}
      <p><a href="${PUBLIC_URL}/#/admin/ai-reports" style="display:inline-block;padding:10px 16px;background:#2C5CD6;color:#fff;border-radius:8px;text-decoration:none">Öppna rapporterna</a></p>
    `, "Automatiskt mejl från PluggEras server."),
  });
}

/** An unexpected server error (alerts.js decides when one is worth a mail). Everything that came
 *  from the error is escaped: this html lands in our own inbox. */
export function sendServerErrorEmail({ where, message, stack, suppressed = 0, at }) {
  return sendEmail({
    to: ALERT_TO(),
    subject: `PluggEra: serverfel – ${String(where).slice(0, 80)}`,
    html: layout(`
      <p><strong>Servern fick ett oväntat fel.</strong> Eleven som råkade ut för det såg "Something went wrong".</p>
      <p><strong>Var:</strong> ${escapeHtml(where)}<br><strong>Fel:</strong> ${escapeHtml(message)}<br><strong>När:</strong> ${escapeHtml(at)} (UTC)</p>
      ${stack ? `<pre style="font-size:12px;background:#F4F6FB;padding:10px;overflow:auto;white-space:pre-wrap">${escapeHtml(stack)}</pre>` : ""}
      ${suppressed ? `<p style="font-size:13px;color:#6B7386">Samma fel har hänt ${suppressed} gång${suppressed === 1 ? "" : "er"} till sedan förra mejlet.</p>` : ""}
      <p style="font-size:13px;color:#6B7386">Se hela loggen: <code>fly logs -a studybuddy-jobble</code></p>
    `, "Automatiskt mejl från PluggEras server. Samma fel mejlas högst en gång i timmen."),
  });
}

export function sendAiRecoveredEmail() {
  return sendEmail({
    to: ALERT_TO(), critical: true, subject: "PluggEra: AI-funktionerna fungerar igen",
    html: layout(`<p>AI:n i PluggEra svarar igen. Inget mer behöver göras.</p>`, "Automatisk kontroll från PluggEras server."),
  });
}

/** A message from the contact form. Reply-To is the sender, so answering it in the inbox just works.
 *  Everything the visitor typed is escaped: this html lands in our own inbox. */
export function sendContactEmail({ name, email, message }) {
  return sendEmail({
    to: CONTACT_TO, replyTo: email, low: true,
    subject: `Kontaktformulär: ${name.replace(/\s+/g, " ")}`,
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;color:#191D28">
      <p style="margin:0 0 4px"><strong>${escapeHtml(name)}</strong> &lt;${escapeHtml(email)}&gt;</p>
      <p style="font-size:12px;color:#6B7386;margin:0 0 16px">Skickat från kontaktformuläret på PluggEra. Svara på det här mejlet för att svara avsändaren.</p>
      <div style="white-space:pre-wrap;font-size:15px;line-height:1.5;border-left:3px solid #2C5CD6;padding-left:12px">${escapeHtml(message)}</div>
    </div>`,
  });
}
