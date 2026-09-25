// Vercel : envoie une notification Telegram pour une commande Star'Farms 51.
// Variables à définir dans Vercel : TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_URL = "https://tfztcaqmjmxbmomosdgo.supabase.co";
const MAX_AGE_MS = 15 * 60 * 1000;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Variables d'environnement manquantes" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const id = body && body.id;
  if (typeof id !== "string" || !/^SF[A-Z0-9]{6,14}$/.test(id)) {
    res.status(400).json({ error: "Référence invalide" });
    return;
  }

  const sb = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: "Bearer " + SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json"
  };

  // Réserve la notification : seulement si la commande existe, est récente et n'a pas déjà été notifiée
  const since = Date.now() - MAX_AGE_MS;
  const claim = await fetch(
    `${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}&notified_at=is.null&date=gte.${since}`,
    { method: "PATCH", headers: { ...sb, Prefer: "return=representation" }, body: JSON.stringify({ notified_at: new Date().toISOString() }) }
  );
  if (!claim.ok) {
    res.status(502).json({ error: "Supabase " + claim.status });
    return;
  }
  const rows = await claim.json();
  if (!rows.length) {
    res.status(200).json({ ok: true, skipped: true });
    return;
  }
  const o = rows[0];

  let items = o.items;
  if (typeof items === "string") { try { items = JSON.parse(items); } catch (e) { items = []; } }
  if (!Array.isArray(items)) items = [];
  const lignes = items
    .map(i => `- ${i.name} ${i.weight || ""} x${i.qty} = ${Number(i.price) * Number(i.qty)} €`)
    .join("\n") || "-";

  const text = [
    `🛸 Nouvelle commande ${o.id}`,
    "",
    `Client : ${o.pseudo || "-"}`,
    `Tél : ${o.phone || "-"}`,
    `Mode : ${o.delivery === "livraison" ? "Livraison" : "Meet-up"}`,
    o.address ? `Adresse : ${o.address}` : null,
    "",
    lignes,
    "",
    `Total : ${o.total} €`,
    o.notes ? `\nNotes : ${o.notes}` : null
  ].filter(l => l !== null).join("\n");

  const tg = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
  });
  if (!tg.ok) {
    // Libère la réservation pour permettre un nouvel essai
    await fetch(`${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(id)}`, {
      method: "PATCH", headers: sb, body: JSON.stringify({ notified_at: null })
    }).catch(() => {});
    const detail = (await tg.text()).slice(0, 200);
    res.status(502).json({ error: "Telegram " + tg.status, detail });
    return;
  }
  res.status(200).json({ ok: true });
};
