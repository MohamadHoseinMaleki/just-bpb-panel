/**
 * secureVpn package worker
 * - Customer: GET /?t=TOKEN  → subscription if valid
 * - Admin:    POST /admin/create  Header X-Admin-Key
 *             GET  /admin/list
 *             POST /admin/revoke  {"token":"..."}
 *
 * Env:
 *   ADMIN_KEY   (secret)
 *   BASE_SUB_URL  full BPB sub URL (raw)
 * Binding:
 *   KV  (KV namespace)
 */

const PROFILE = "secureVpn";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    try {
      if (path.startsWith("/admin")) {
        return await handleAdmin(request, env, path);
      }
      if (request.method === "GET" && (path === "/" || path === "/sub")) {
        return await handleSub(request, env, url);
      }
      return new Response("secureVpn package worker\nGET /?t=TOKEN\n", { status: 200 });
    } catch (e) {
      return new Response("Error: " + String(e), { status: 500 });
    }
  },
};

function requireAdmin(request, env) {
  const key = request.headers.get("X-Admin-Key") || "";
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    return false;
  }
  return true;
}

async function handleAdmin(request, env, path) {
  if (!requireAdmin(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!env.KV) return json({ error: "KV binding missing" }, 500);

  if (path === "/admin/create" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const days = Number(body.days || 30);
    const maxGB = Number(body.maxGB || 0);
    const note = String(body.note || "");
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const expiresAt = new Date(Date.now() + days * 864e5).toISOString();
    const maxBytes = maxGB > 0 ? Math.floor(maxGB * 1024 * 1024 * 1024) : 0;
    const rec = {
      token,
      note,
      createdAt: new Date().toISOString(),
      expiresAt,
      maxBytes,
      usedBytes: 0,
      hits: 0,
      active: true,
    };
    await env.KV.put("pkg:" + token, JSON.stringify(rec));
    const list = JSON.parse((await env.KV.get("pkg:index")) || "[]");
    list.unshift(token);
    await env.KV.put("pkg:index", JSON.stringify(list.slice(0, 5000)));
    const origin = new URL(request.url).origin;
    return json({
      token,
      url: origin + "/?t=" + token,
      expiresAt,
      maxBytes,
      note,
    });
  }

  if (path === "/admin/list" && request.method === "GET") {
    const list = JSON.parse((await env.KV.get("pkg:index")) || "[]");
    const rows = [];
    for (const t of list.slice(0, 200)) {
      const raw = await env.KV.get("pkg:" + t);
      if (raw) rows.push(JSON.parse(raw));
    }
    return json({ count: rows.length, packages: rows });
  }

  if (path === "/admin/revoke" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const token = body.token;
    if (!token) return json({ error: "token required" }, 400);
    const raw = await env.KV.get("pkg:" + token);
    if (!raw) return json({ error: "not found" }, 404);
    const rec = JSON.parse(raw);
    rec.active = false;
    rec.revokedAt = new Date().toISOString();
    await env.KV.put("pkg:" + token, JSON.stringify(rec));
    return json({ ok: true, token });
  }

  return json({ error: "unknown admin route" }, 404);
}

async function handleSub(request, env, url) {
  const token = url.searchParams.get("t") || url.searchParams.get("token");
  if (!token) return new Response("Missing t=TOKEN", { status: 400 });
  if (!env.KV) return new Response("KV not bound", { status: 500 });
  if (!env.BASE_SUB_URL) return new Response("BASE_SUB_URL not set", { status: 500 });

  const raw = await env.KV.get("pkg:" + token);
  if (!raw) return new Response("Invalid token", { status: 403 });
  const rec = JSON.parse(raw);

  if (!rec.active) return new Response("Package revoked", { status: 403 });
  if (new Date(rec.expiresAt).getTime() < Date.now()) {
    return new Response("Package expired", { status: 403 });
  }
  if (rec.maxBytes > 0 && rec.usedBytes >= rec.maxBytes) {
    return new Response("Traffic quota exceeded", { status: 403 });
  }

  // Fetch base sub (from user PC this works; from worker may need static fallback)
  let text;
  try {
    const upstream = await fetch(env.BASE_SUB_URL, {
      headers: { "User-Agent": request.headers.get("User-Agent") || "v2rayNG/1.10.23" },
    });
    if (!upstream.ok) {
      // fallback: cached body
      text = await env.KV.get("cache:subbody");
      if (!text) {
        return new Response("Upstream sub failed: " + upstream.status + " (run admin warm-cache from PC)", {
          status: 502,
        });
      }
    } else {
      text = await upstream.text();
      await env.KV.put("cache:subbody", text, { expirationTtl: 3600 });
    }
  } catch (e) {
    text = await env.KV.get("cache:subbody");
    if (!text) return new Response("Fetch error: " + String(e), { status: 502 });
  }

  const rewritten = rewriteSubscription(text);
  const bytes = new TextEncoder().encode(rewritten).length;
  rec.usedBytes = (rec.usedBytes || 0) + bytes;
  rec.hits = (rec.hits || 0) + 1;
  rec.lastAccess = new Date().toISOString();
  await env.KV.put("pkg:" + token, JSON.stringify(rec));

  const headers = new Headers({
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "Profile-Title": "base64:" + btoa(unescape(encodeURIComponent(PROFILE))),
  });
  // client-facing quota hint (soft)
  if (rec.maxBytes > 0) {
    headers.set(
      "Subscription-Userinfo",
      `upload=0; download=${rec.usedBytes}; total=${rec.maxBytes}; expire=${Math.floor(
        new Date(rec.expiresAt).getTime() / 1000
      )}`
    );
  } else {
    headers.set(
      "Subscription-Userinfo",
      `upload=0; download=0; total=0; expire=${Math.floor(new Date(rec.expiresAt).getTime() / 1000)}`
    );
  }

  return new Response(rewritten, { status: 200, headers });
}

function rewriteSubscription(raw) {
  const { lines, wasBase64 } = normalizeToLines(raw);
  const out = lines.map((line, i) => rewriteLine(line, i + 1)).filter(Boolean);
  let body = out.join("\n");
  if (wasBase64) body = btoa(unescape(encodeURIComponent(body)));
  return body;
}

function normalizeToLines(raw) {
  const trimmed = raw.trim();
  if (/^(vless|vmess|trojan|ss):\/\//im.test(trimmed)) {
    return { lines: trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), wasBase64: false };
  }
  try {
    const decoded = decodeURIComponent(escape(atob(trimmed.replace(/\s/g, ""))));
    if (decoded.includes("://")) {
      return { lines: decoded.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), wasBase64: true };
    }
  } catch {}
  return { lines: trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean), wasBase64: false };
}

function rewriteLine(line, index) {
  if (!line || line.startsWith("#")) return line;
  const hash = line.indexOf("#");
  if (hash !== -1 && /^(vless|trojan|ss):\/\//i.test(line)) {
    const base = line.slice(0, hash);
    const old = safeDecode(line.slice(hash + 1));
    const name = buildName(old, index, line);
    return base + "#" + encodeURIComponent(name);
  }
  return line;
}

function buildName(old, index, line) {
  const host = (line.match(/@([^:?/]+)/) || [])[1] || "";
  if (/workers\.dev|pages\.dev/i.test(host)) return `${PROFILE} | Cloudflare`;
  if (/Clean\s*IP/i.test(old)) return `${PROFILE} | Clean IP`;
  if (/Best\s*Ping/i.test(old)) return `${PROFILE} | Best Ping`;
  if (/IPv6/i.test(old)) return `${PROFILE} | IPv6`;
  if (/IPv4/i.test(old)) return `${PROFILE} | IPv4`;
  if (/Domain/i.test(old)) return `${PROFILE} | Cloudflare`;
  return `${PROFILE} | ${index}`;
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
