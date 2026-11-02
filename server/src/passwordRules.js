// What a new password has to be. One place, so sign-up, reset, the Google link and a change all say the same.

// The most used passwords that are long enough to pass the length check, English and Swedish. Not a full
// breach list: it stops the guesses that are tried first, and needs no download or third party.
const COMMON = new Set(`
12345678 123456789 1234567890 12345678910 87654321 987654321 0987654321 11223344 112233445566 123123123 1234512345 12344321
password password1 password12 password123 password1234 passw0rd p@ssword p@ssw0rd pass1234 passpass mypassword
losenord losenord1 losenord12 losenord123 lösenord lösenord1 lösenord12 lösenord123 hemligt1 hemligt123
qwertyui qwerty12 qwerty123 qwerty1234 qwertyuiop 1qaz2wsx qazwsxedc asdfghjk asdfghjkl asdf1234 zxcvbnm1 zxcvbnm123
abcd1234 abc12345 abc123456 abcdefgh abcdefghi a1b2c3d4 aa123456 1q2w3e4r 1q2w3e4r5t
iloveyou iloveyou1 sunshine princess football football1 baseball superman batman123 starwars michael1 jennifer
welcome1 welcome123 letmein1 letmein123 admin123 admin1234 administrator trustno1 changeme changeme1 monkey123 dragon123
fotboll1 fotboll123 sommar123 sverige1 sverige123 stockholm jagälskardig jagalskardig hejhejhej hejsan123 pluggera pluggera1 pluggera123
`.trim().split(/\s+/));

/** Is it all one character, or a run of digits counting up or down ("aaaaaaaa", eight spaces, "23456789")? */
function isTrivial(password) {
  if (new Set(password).size === 1) return true;
  if (!/^\d+$/.test(password)) return false;
  const steps = new Set([...password].slice(1).map((d, i) => Number(d) - Number(password[i])));
  return steps.size === 1 && (steps.has(1) || steps.has(-1));
}

/** The message to answer with if this can't be a password, or null if it can. */
export function passwordProblem(password) {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";   // bcrypt only reads 72 bytes; don't hash a novel
  if (isTrivial(password) || COMMON.has(password.toLowerCase())) return "That password is too easy to guess. Choose another one.";
  return null;
}
