/**
 * secureVpn package worker (complete)
 * Customer: GET /?t=TOKEN
 * Admin:
 *   POST /admin/create   {days, maxGB, note}  Header X-Admin-Key
 *   GET  /admin/list
 *   POST /admin/revoke   {token}
 *   POST /admin/warm-cache  {body?: string}  OR fetches BASE_SUB_URL if reachable
 *   POST /admin/set-cache   {body: "...raw sub text..."}  ← from PC when worker cannot fetch panel
 *
 * Env: ADMIN_KEY, BASE_SUB_URL
 * Binding: KV
 */

const PROFILE = "secureVpn";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path.startsWith("/admin")) return await handleAdmin(request, env, path);
      if (request.method === "GET" && (path === "/" || path === "/sub")) {
        return await handleSub(request, env, url);
      }
      return new Response(
        "secureVpn package worker\nGET /?t=TOKEN\nAdmin: /admin/create|list|revoke|set-cache\n",
        { status: 200 }
      );
    } catch (e) {
      return new Response("Error: " + String(e), { status: 500 });
    }
  },
};

function requireAdmin(request, env) {
  const key = request.headers.get("X-Admin-Key") || "";
  return !!(env.ADMIN_KEY && key === env.ADMIN_KEY);
}

async function handleAdmin(request, env, path) {
  if (!requireAdmin(request, env)) return json({ error: "unauthorized" }, 401);
  if (!env.KV) return json({ error: "KV binding missing" }, 500);

  if (path === "/admin/create" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const days = Math.max(1, Number(body.days || 30));
    const maxGB = Number(body.maxGB || 0);
    const note = String(body.note || "");
    const token =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "").slice(0, 8);
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
      maxGB: maxGB || null,
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
    if (!body.token) return json({ error: "token required" }, 400);
    const raw = await env.KV.get("pkg:" + body.token);
    if (!raw) return json({ error: "not found" }, 404);
    const rec = JSON.parse(raw);
    rec.active = false;
    rec.revokedAt = new Date().toISOString();
    await env.KV.put("pkg:" + body.token, JSON.stringify(rec));
    return json({ ok: true, token: body.token });
  }

  // Upload sub body from your PC (recommended — avoids worker-to-worker 404)
  if (path === "/admin/set-cache" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const text = body.body || body.text || "";
    if (!text || text.length < 20) return json({ error: "body too short" }, 400);
    await env.KV.put("cache:subbody", text);
    await env.KV.put(
      "cache:meta",
      JSON.stringify({ updatedAt: new Date().toISOString(), bytes: text.length })
    );
    return json({ ok: true, bytes: text.length });
  }

  if (path === "/admin/warm-cache" && request.method === "POST") {
    if (!env.BASE_SUB_URL) return json({ error: "BASE_SUB_URL not set" }, 500);
    const upstream = await fetch(env.BASE_SUB_URL, {
      headers: { "User-Agent": "v2rayNG/1.10.23" },
    });
    if (!upstream.ok) {
      return json(
        {
          error: "upstream failed",
          status: upstream.status,
          hint: "Use POST /admin/set-cache with body from rewrite-sub.ps1 output",
        },
        502
      );
    }
    const text = await upstream.text();
    await env.KV.put("cache:subbody", text);
    return json({ ok: true, bytes: text.length, via: "BASE_SUB_URL" });
  }

  return json({ error: "unknown admin route" }, 404);
}

async function handleSub(request, env, url) {
  const token = url.searchParams.get("t") || url.searchParams.get("token");
  if (!token) return new Response("Missing t=TOKEN", { status: 400 });
  if (!env.KV) return new Response("KV not bound", { status: 500 });

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

  let text = await env.KV.get("cache:subbody");
  if (!text && env.BASE_SUB_URL) {
    try {
      const upstream = await fetch(env.BASE_SUB_URL, {
        headers: {
          "User-Agent": request.headers.get("User-Agent") || "v2rayNG/1.10.23",
        },
      });
      if (upstream.ok) {
        text = await upstream.text();
        await env.KV.put("cache:subbody", text);
      }
    } catch {}
  }
  if (!text) {
    return new Response(
      "No subscription cache. Admin must POST /admin/set-cache with sub body.",
      { status: 503 }
    );
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
    "Profile-Title":
      "base64:" + btoa(unescape(encodeURIComponent(PROFILE))),
  });
  const expireSec = Math.floor(new Date(rec.expiresAt).getTime() / 1000);
  const total = rec.maxBytes > 0 ? rec.maxBytes : 0;
  headers.set(
    "Subscription-Userinfo",
    `upload=0; download=${rec.usedBytes}; total=${total}; expire=${expireSec}`
  );

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
    return {
      lines: trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
      wasBase64: false,
    };
  }
  try {
    const decoded = decodeURIComponent(escape(atob(trimmed.replace(/\s/g, ""))));
    if (decoded.includes("://")) {
      return {
        lines: decoded.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
        wasBase64: true,
      };
    }
  } catch {}
  return {
    lines: trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
    wasBase64: false,
  };
}

function rewriteLine(line, index) {
  if (!line || line.StartsWith === true) return line;
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
  if (/workers\.dev|pages\.dev/i.test(host)) return PROFILE + " | Cloudflare";
  if (/Clean\s*IP/i.test(old)) return PROFILE + " | Clean IP";
  if (/Best\s*Ping/i.test(old)) return PROFILE + " | Best Ping";
  if (/IPv6/i.test(old)) return PROFILE + " | IPv6";
  if (/IPv4/i.test(old)) return PROFILE + " | IPv4";
  if (/Domain/i.test(old)) return PROFILE + " | Cloudflare";
  return PROFILE + " | " + index;
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
