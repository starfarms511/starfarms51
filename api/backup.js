// Vercel Cron (hebdomadaire) : sauvegarde CHIFFRÉE des commandes et produits, envoyée par email (Resend).
// Variables Vercel : SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, BACKUP_EMAIL, BACKUP_PASSWORD, CRON_SECRET
const crypto = require("crypto");
const SUPABASE_URL = "https://tfztcaqmjmxbmomosdgo.supabase.co";
const SITE_URL = "https://starfarms-51.vercel.app";
const TZ = "Europe/Paris";
const ITERATIONS = 600000;

function cell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(header, rows) { return "\uFEFF" + [header, ...rows].map(r => r.map(cell).join(";")).join("\r\n"); }
function num(n) { return n === null || n === undefined || n === "" ? "" : String(Math.round(Number(n) * 100) / 100).replace(".", ","); }
function parseJson(x) { if (typeof x === "string") { try { return JSON.parse(x); } catch (e) { return []; } } return Array.isArray(x) ? x : []; }

// Format du fichier .sf51 : "SF51BK1" | itérations (4 octets) | sel (16) | IV (12) | données chiffrées + tag GCM (16)
function encrypt(text, password) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(text, "utf8")), c.final()]);
  const it = Buffer.alloc(4); it.writeUInt32BE(ITERATIONS);
  return Buffer.concat([Buffer.from("SF51BK1"), it, salt, iv, ct, c.getAuthTag()]);
}

module.exports = async (req, res) => {
  const { SUPABASE_SERVICE_ROLE_KEY: SRK, RESEND_API_KEY, BACKUP_EMAIL, BACKUP_PASSWORD, CRON_SECRET } = process.env;
  if (!CRON_SECRET || req.headers.authorization !== "Bearer " + CRON_SECRET) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }
  if (!SRK || !RESEND_API_KEY || !BACKUP_EMAIL || !BACKUP_PASSWORD) {
    res.status(500).json({ error: "Variables d'environnement manquantes" });
    return;
  }
  if (BACKUP_PASSWORD.length < 12) {
    res.status(500).json({ error: "BACKUP_PASSWORD trop court (12 caractères minimum)" });
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

    const orderRows = orders.map(o => {
      const items = parseJson(o.items).map(i => `${i.name} ${i.weight || ""} x${i.qty}`).join(" | ");
      const total = Number(o.total) || 0, disc = Number(o.discount) || 0, paid = total - disc;
      const p = o.cost_total === null || o.cost_total === undefined ? null : paid - Number(o.cost_total);
      return [
        o.id,
        o.date ? new Date(Number(o.date)).toLocaleString("fr-FR", { timeZone: TZ }) : "",
        o.pseudo, o.phone, o.delivery === "livraison" ? "Livraison" : "Meet-up", o.address,
        items, num(total), num(disc), num(paid), num(o.cost_total), num(p), o.cost_complete === true ? "oui" : "non", o.notes
      ];
    });
    const productRows = products.map(p => [
      p.id, p.name, p.cat, ({ active: "Disponible", soldout: "Victime de son succès" })[p.status] || "Masqué",
      parseJson(p.formats).map(f => `${f.w} = ${f.p} €`).join(" | "), num(costOf[p.id])
    ]);

    const day = new Date().toLocaleDateString("fr-CA", { timeZone: TZ });
    const dayFr = new Date().toLocaleDateString("fr-FR", { timeZone: TZ });
    const files = [
      [`commandes-${day}.csv.sf51`, toCsv(["Référence", "Date", "Pseudo", "Téléphone", "Mode", "Adresse", "Articles", "Total €", "Remise €", "Encaissé €", "Coût €", "Profit €", "Coût complet", "Notes"], orderRows)],
      [`produits-${day}.csv.sf51`, toCsv(["ID", "Nom", "Catégorie", "Statut", "Formats", "Prix d'achat €/g"], productRows)]
    ];

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sauvegarde <onboarding@resend.dev>",
        to: [BACKUP_EMAIL],
        subject: `Sauvegarde chiffrée du ${dayFr}`,
        text:
          `Ta sauvegarde hebdomadaire est en pièce jointe : 2 fichiers chiffrés (.sf51).\n\n` +
          `Pour les ouvrir : ${SITE_URL}/dechiffrer.html\n` +
          `Choisis un fichier, saisis ton mot de passe de sauvegarde, puis télécharge le fichier Excel.\n\n` +
          `Sans ce mot de passe, le contenu est illisible.`,
        attachments: files.map(([name, text]) => ({ filename: name, content: encrypt(text, BACKUP_PASSWORD).toString("base64") }))
      })
    });
    if (!r.ok) throw new Error("Resend " + r.status + " " + (await r.text()).slice(0, 200));
    res.status(200).json({ ok: true, commandes: orders.length, produits: products.length });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
