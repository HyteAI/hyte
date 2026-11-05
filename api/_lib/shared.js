import { createClient } from "@supabase/supabase-js";

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function send(res, status, value) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return res.status(status).json(value);
}

export function handleError(res, error) {
  if (error.name === "ZodError")
    return send(res, 400, {
      error:
        "Some fields are invalid. Check the dates, times, and required values.",
    });
  if (!error.status) console.error("Hyte API failed:", error.message);
  return send(res, error.status || 500, {
    error: error.status
      ? error.message
      : "The service could not complete this request. Please try again.",
  });
}

export function requireMethod(req, res, allowed) {
  if (allowed.includes(req.method)) return;
  res.setHeader("Allow", allowed.join(", "));
  throw httpError(405, "This request method is not supported.");
}

export function body(req, limit = 64_000) {
  const raw =
    typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  if (Buffer.byteLength(raw, "utf8") > limit)
    throw httpError(413, "This upload is too large. Choose a smaller image.");
  try {
    return JSON.parse(raw);
  } catch {
    throw httpError(400, "The request must contain valid JSON.");
  }
}

export function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !process.env.HYTE_OWNER_ID)
    throw httpError(
      503,
      "Private cloud services are not connected yet. Complete the Supabase setup first.",
    );
  return { url, key };
}

export function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw httpError(
      503,
      "The server database connection has not been configured.",
    );
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function requireOwner(req) {
  const { url, key } = supabaseConfig();
  const token = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "")?.[1];
  if (!token || token.length > 10_000)
    throw httpError(401, "Sign in to your Hyte account first.");
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const {
    data: { user },
    error,
  } = await db.auth.getUser(token);
  if (error || !user)
    throw httpError(401, "Your session has expired. Please sign in again.");
  if (user.id !== process.env.HYTE_OWNER_ID || user.is_anonymous)
    throw httpError(403, "This Hyte account is private.");
  const owner = await db
    .from("hyte_owners")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (owner.error)
    throw httpError(
      503,
      "The private database schema is not ready. Complete the cloud setup.",
    );
  if (!owner.data)
    throw httpError(403, "This account has not been added as the Hyte owner.");
  return { db, user };
}

export function checkDb(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function pushConfigured() {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function schedulerConfigured() {
  return (
    pushConfigured() &&
    process.env.HYTE_SCHEDULER_ENABLED === "true" &&
    Boolean(process.env.CRON_SECRET)
  );
}
