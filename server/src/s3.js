// A small S3 client: PUT, LIST and DELETE of objects with AWS Signature Version 4, over fetch. It exists so
// the nightly backup (backup.js) can reach any S3-compatible store (Fly's Tigris, Backblaze B2, ...) without
// pulling in an SDK with a long tree of dependencies. Only what the backup needs.

import crypto from "node:crypto";

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding as SigV4 wants it ("/" kept in a path, encoded in a query value).
const encode = (s, keepSlash) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/g, keepSlash ? "/" : "%2F");

/** The headers to send for a signed request. `headers` are the ones to sign besides host and x-amz-date
 *  (and x-amz-content-sha256 for S3). Returns all headers including Authorization. */
export function signRequest({ method, url, region, service = "s3", accessKey, secretKey, body = "", headers = {}, now = new Date(), s3 = true }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");   // 20150830T123600Z
  const day = amzDate.slice(0, 8);
  const payloadHash = sha256(body);
  const all = { ...headers, host: u.host, "x-amz-date": amzDate };
  if (s3) all["x-amz-content-sha256"] = payloadHash;
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]));
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...u.searchParams.entries()]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join("&");
  const canonicalPath = u.pathname.split("/").map((seg) => encode(decodeURIComponent(seg))).join("/") || "/";
  const canonical = [method, canonicalPath, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + secretKey, day), region), service), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(toSign).digest("hex");
  return {
    ...all,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/** `cfg`: { endpoint, bucket, region, accessKey, secretKey }. Path-style URLs: endpoint/bucket/key. */
export function s3Client(cfg, { fetchImpl = fetch, now = () => new Date() } = {}) {
  const base = String(cfg.endpoint).replace(/\/+$/, "");
  const urlFor = (key, query = "") => `${base}/${encode(cfg.bucket)}${key ? "/" + encode(key, true) : ""}${query}`;
  async function call(method, url, body = "") {
    const headers = signRequest({ method, url, region: cfg.region || "auto", accessKey: cfg.accessKey, secretKey: cfg.secretKey, body, now: now() });
    const res = await fetchImpl(url, { method, headers, body: method === "PUT" ? body : undefined, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`S3 ${method} answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return res;
  }
  return {
    async put(key, body) { await call("PUT", urlFor(key), body); },
    async del(key) { await call("DELETE", urlFor(key)); },
    /** Objects whose key starts with `prefix`: [{ key, lastModified: Date }]. Follows continuation tokens. */
    async list(prefix) {
      const out = [];
      let token = "";
      do {
        const q = `?list-type=2&prefix=${encode(prefix)}${token ? `&continuation-token=${encode(token)}` : ""}`;
        const xml = await (await call("GET", urlFor("", q))).text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          const key = m[1].match(/<Key>([\s\S]*?)<\/Key>/)?.[1];
          const when = m[1].match(/<LastModified>([\s\S]*?)<\/LastModified>/)?.[1];
          if (key) out.push({ key: key.replace(/&amp;/g, "&"), lastModified: new Date(when) });
        }
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] || "" : "";
      } while (token);
      return out;
    },
  };
}
