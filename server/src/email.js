// Transactional email — verification links, password resets. Off by default, like Google sign-in
// (see google.js): with no RESEND_API_KEY, emailEnabled() is false, nothing here is ever called,
// and signup/login behave exactly as they did before this file existed. Set the key to turn it on.
//
// Resend (https://resend.com) is the one provider wired up: a single HTTPS call, no SDK. Swapping
// providers later means changing sendEmail() below — nothing that calls it needs to know how.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || "Studify <onboarding@resend.dev>";

export function emailEnabled() {
  return !!RESEND_API_KEY;
}

/** Best-effort: returns false (and logs) on any failure rather than throwing, so a flaky provider
 *  never turns into a 500 on signup or password reset — the token is already stored either way,
 *  and resend-verification exists for exactly this case. */
export async function sendEmail({ to, subject, html }) {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to, subject, html }),
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

function layout(bodyHtml) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#191D28">
    <h1 style="font-size:20px;margin:0 0 16px">Studify</h1>
    ${bodyHtml}
    <p style="font-size:12px;color:#6B7386;margin-top:32px">If you didn't request this, you can ignore this email.</p>
  </div>`;
}

export function sendVerifyEmail(to, token) {
  const url = `${PUBLIC_URL}/#/verify?token=${token}`;
  return sendEmail({
    to, subject: "Confirm your email for Studify",
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
    to, subject: "Reset your Studify password",
    html: layout(`
      <p>Someone asked to reset the password for this Studify account. Tap the button below to set a new one.</p>
      <p><a href="${url}" style="display:inline-block;background:#2C5CD6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Reset password</a></p>
      <p style="font-size:13px;color:#6B7386">Or paste this link into your browser: ${url}</p>
      <p style="font-size:13px;color:#6B7386">This link works for 1 hour. Your current password still works until you use it.</p>
    `),
  });
}
