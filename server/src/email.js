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
// with email 2FA would be locked out of signing in. So the quota is tiered: `low` mail (signup
// verification, the contact form — anyone can trigger them in bulk) stops at 40% of the daily
// budget, ordinary mail (password resets) at 60%, and only `critical` mail (sign-in codes) may use
// the rest. In-memory, per process, resets at UTC midnight and on restart — like every limiter
// here. EMAIL_DAILY_BUDGET=0 switches it off.
const DAILY_BUDGET = (() => {
  const n = Number(process.env.EMAIL_DAILY_BUDGET);
  return Number.isFinite(n) && n >= 0 && process.env.EMAIL_DAILY_BUDGET?.trim() ? n : 100;
})();
let budgetDay = "";
let budgetUsed = 0;
function takeBudget(critical, low) {
  if (!(DAILY_BUDGET > 0)) return true;
  const day = new Date().toISOString().slice(0, 10);
  if (day !== budgetDay) { budgetDay = day; budgetUsed = 0; }
  const ceiling = critical ? DAILY_BUDGET : Math.floor(DAILY_BUDGET * (low ? 0.4 : 0.6));
  if (budgetUsed >= ceiling) { console.warn("[email] daily budget reached", { critical, budgetUsed }); return false; }
  budgetUsed++;
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

function layout(bodyHtml, footer = "If you didn't request this, you can ignore this email.") {
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

export function sendVerifyEmail(to, token) {
  const url = `${PUBLIC_URL}/#/verify?token=${token}`;
  return sendEmail({
    to, low: true, subject: "Confirm your email for PluggEra",
    html: layout(`
      <p>Tap the button below to confirm this is your email address.</p>
      <p><a href="${url}" style="display:inline-block;background:#2C5CD6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Confirm email</a></p>
      <p style="font-size:13px;color:#6B7386">Or paste this link into your browser: ${url}</p>
      <p style="font-size:13px;color:#6B7386">This link works for 24 hours.</p>
    `),
  });
}

export function sendResetEmail(to, token) {
  const url = `${PUBLIC_URL}/#/reset?token=${token}`;
  return sendEmail({
    to, subject: "Reset your PluggEra password",
    html: layout(`
      <p>Someone asked to reset the password for this PluggEra account. Tap the button below to set a new one.</p>
      <p><a href="${url}" style="display:inline-block;background:#2C5CD6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Reset password</a></p>
      <p style="font-size:13px;color:#6B7386">Or paste this link into your browser: ${url}</p>
      <p style="font-size:13px;color:#6B7386">This link works for 1 hour. Your current password still works until you use it.</p>
    `),
  });
}

// Best-effort notice for a security-relevant change made with an already-signed-in session, so
// the account owner finds out even if it wasn't them (a stolen session cookie, say).
export function sendTwoFaEnabledEmail(to) {
  return sendEmail({
    to, subject: "Two-factor authentication turned on",
    html: layout(`
      <p>Two-factor authentication was just turned on for this PluggEra account. From now on, signing in needs a code from your authenticator app as well as your password.</p>
      <p style="font-size:13px;color:#6B7386">If this wasn't you, sign in and turn it off again from Settings, then change your password.</p>
    `),
  });
}

export function sendTwoFaDisabledEmail(to) {
  return sendEmail({
    to, subject: "Two-factor authentication turned off",
    html: layout(`
      <p>Two-factor authentication was just turned off for this PluggEra account. Signing in now only needs your password.</p>
      <p style="font-size:13px;color:#6B7386">If this wasn't you, sign in, turn it back on from Settings, and change your password.</p>
    `),
  });
}

// The sign-in / enrolment code. The code is deliberately NOT in the subject: subjects show on lock
// screens and in notification previews. `critical` lets it use the quota reserve (see takeBudget).
export function sendTwoFaCodeEmail(to, code, purpose) {
  const what = purpose === "enroll" ? "turn on two-factor authentication" : "sign in";
  return sendEmail({
    // Only sign-in codes may use the reserve: turning 2FA on can wait, and an account that turns
    // it on over and over must not be able to spend the codes everyone else needs to sign in.
    to, critical: purpose !== "enroll", subject: "Your PluggEra verification code",
    html: layout(`
      <p>Your code to ${what}:</p>
      <p style="font-size:30px;letter-spacing:6px;font-weight:700;margin:12px 0">${code}</p>
      <p style="font-size:13px;color:#6B7386">It works for 10 minutes. If you didn't just try to ${what}, someone may have your password — change it, and don't share this code with anyone.</p>
    `),
  });
}

export function sendPasswordAddedEmail(to) {
  return sendEmail({
    to, subject: "A password was added to your PluggEra account",
    html: layout(`
      <p>A password was just added to this PluggEra account, confirmed through your Google sign-in. From now on you can sign in either with Google or with your email and this password.</p>
      <p style="font-size:13px;color:#6B7386">If this wasn't you, sign in with Google to check your account — whoever did this would need your Google sign-in to do it again.</p>
    `),
  });
}

// Where the contact form (#/contact, routes/contact.js) delivers. The client shows the same address
// for anyone who'd rather write from their own mail app — keep it in step with js/config.js.
export const CONTACT_TO = process.env.CONTACT_TO || "pluggera.organisation@gmail.com";

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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
