// Vercel Cron (quotidien) : maintient le projet Supabase actif.
// Variables Vercel : SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
const SUPABASE_URL = "https://tfztcaqmjmxbmomosdgo.supabase.co";

module.exports = async (req, res) => {
  const { SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET } = process.env;
  if (!CRON_SECRET || req.headers.authorization !== "Bearer " + CRON_SECRET) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }
  const r = await fetch(`${SUPABASE_URL}/rest/v1/categories?select=id&limit=1`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY }
  });
  res.status(r.ok ? 200 : 502).json({ ok: r.ok, supabase: r.status, at: new Date().toISOString() });
};
