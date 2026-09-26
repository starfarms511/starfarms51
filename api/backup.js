// Vercel Cron (hebdomadaire) : envoie une sauvegarde CSV des commandes et des produits sur Telegram.
// Variables Vercel : SUPABASE_SERVICE_ROLE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CRON_SECRET
const SUPABASE_URL = "https://tfztcaqmjmxbmomosdgo.supabase.co";
const TZ = "Europe/Paris";

function cell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(header, rows) {
  return "\uFEFF" + [header, ...rows].map(r => r.map(cell).join(";")).join("\r\n");
}
function num(n) { return n === null || n === undefined || n === "" ? "" : String(Math.round(Number(n) * 100) / 100).replace(".", ","); }
function parseJson(x) { if (typeof x === "string") { try { return JSON.parse(x); } catch (e) { return []; } } return Array.isArray(x) ? x : []; }
function euros(n) { return (Math.round(n * 100) / 100).toLocaleString("fr-FR") + " €"; }

module.exports = async (req, res) => {
  const { SUPABASE_SERVICE_ROLE_KEY: SRK, TELEGRAM_BOT_TOKEN: TOK, TELEGRAM_CHAT_ID: CHAT, CRON_SECRET } = process.env;
  if (!CRON_SECRET || req.headers.authorization !== "Bearer " + CRON_SECRET) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }
  if (!SRK || !TOK || !CHAT) {
    res.status(500).json({ error: "Variables d'environnement manquantes" });
    return;
  }
  const sb = path => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SRK, Authorization: "Bearer " + SRK } })
    .then(r => { if (!r.ok) throw new Error("Supabase " + r.status + " sur " + path.split("?")[0]); return r.json(); });

  try {
    const [orders, products, costs] = await Promise.all([
      sb("orders?select=*&order=date.asc"),
      sb("products?select=id,name,cat,status,formats,created_at&order=created_at.asc"),
      sb("product_costs?select=product_id,cost_per_gram").catch(() => [])
    ]);
    const costOf = Object.fromEntries(costs.map(c => [c.product_id, c.cost_per_gram]));

    let ca = 0, profit = 0;
    const orderRows = orders.map(o => {
      const items = parseJson(o.items).map(i => `${i.name} ${i.weight || ""} x${i.qty}`).join(" | ");
      const total = Number(o.total) || 0;
      const p = o.cost_total === null || o.cost_total === undefined ? null : total - Number(o.cost_total);
      ca += total; if (p !== null) profit += p;
      return [
        o.id,
        o.date ? new Date(Number(o.date)).toLocaleString("fr-FR", { timeZone: TZ }) : "",
        o.pseudo, o.phone, o.delivery === "livraison" ? "Livraison" : "Meet-up", o.address,
        items, num(total), num(o.cost_total), num(p), o.cost_complete === true ? "oui" : "non", o.notes
      ];
    });
    const productRows = products.map(p => [
      p.id, p.name, p.cat, p.status === "active" ? "Disponible" : "Indisponible",
      parseJson(p.formats).map(f => `${f.w} = ${f.p} €`).join(" | "), num(costOf[p.id])
    ]);

    const day = new Date().toLocaleDateString("fr-CA", { timeZone: TZ });
    const files = [
      [`commandes-${day}.csv`, toCsv(["Référence", "Date", "Pseudo", "Téléphone", "Mode", "Adresse", "Articles", "Total €", "Coût €", "Profit €", "Coût complet", "Notes"], orderRows)],
      [`produits-${day}.csv`, toCsv(["ID", "Nom", "Catégorie", "Statut", "Formats", "Prix d'achat €/g"], productRows)]
    ];
    const caption = `💾 Sauvegarde du ${new Date().toLocaleDateString("fr-FR", { timeZone: TZ })}\n${orders.length} commande${orders.length > 1 ? "s" : ""} · CA ${euros(ca)} · profit ${euros(profit)}\n${products.length} produit${products.length > 1 ? "s" : ""}`;

    for (let k = 0; k < files.length; k++) {
      const fd = new FormData();
      fd.append("chat_id", CHAT);
      fd.append("document", new Blob([files[k][1]], { type: "text/csv" }), files[k][0]);
      if (k === 0) fd.append("caption", caption);
      const t = await fetch(`https://api.telegram.org/bot${TOK}/sendDocument`, { method: "POST", body: fd });
      if (!t.ok) throw new Error("Telegram " + t.status + " " + (await t.text()).slice(0, 150));
    }
    res.status(200).json({ ok: true, commandes: orders.length, produits: products.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
