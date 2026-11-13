// helper-access: parents add or remove the household helper's sign-in.
// Creates the helper's account (so they can sign in with an emailed code) and gives it the limited 'helper' role.
import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: ok } = await db.rpc("wb_is_member");
  if (ok !== true) return json({ error: "Only parents can change helper access." }, 401);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // deno-lint-ignore no-explicit-any
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  if (body.action === "list") {
    const { data } = await admin.from("wb_members").select("email,display_name").eq("role", "helper");
    return json({ helpers: data ?? [] });
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (body.action === "add") {
    const { data: exists } = await admin.from("wb_members").select("role").eq("email", email).maybeSingle();
    if (exists && exists.role !== "helper") return json({ error: "That email already belongs to a parent." }, 400);
    const name = String(body.name ?? "").trim().slice(0, 30) || "Helper";
    const { error: cu } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (cu && !/already/i.test(cu.message)) return json({ error: cu.message }, 400);
    const { error } = await admin.from("wb_members").upsert({ email, display_name: name, role: "helper" });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }
  if (body.action === "remove") {
    const { error } = await admin.from("wb_members").delete().eq("email", email).eq("role", "helper");
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }
  return json({ error: "Unknown request." }, 400);
});
