// Vercel : webhook du bot Telegram. Répond à /start avec la carte de bienvenue.
// Variables Vercel : TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET
const SHOP_URL = "https://starfarms-51.vercel.app/";
const IMAGE_URL = "https://starfarms-51.vercel.app/bienvenue.jpg";
const CHANNEL_URL = "https://t.me/+uYWHra2ouU0zNmY0";
const CONTACT_URL = "https://t.me/laligue51_com";

const KEYBOARD = {
  inline_keyboard: [
    [{ text: "🛸 STAR'FARMS MENU", web_app: { url: SHOP_URL } }],
    [{ text: "📢 CANAL TELEGRAM", url: CHANNEL_URL }],
    [{ text: "💬 CONTACT", url: CONTACT_URL }]
  ]
};

function esc(s) { return String(s || "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

async function tg(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) console.error(method, r.status, (await r.text()).slice(0, 200));
  return r.ok;
}

module.exports = async (req, res) => {
  const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET } = process.env;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_WEBHOOK_SECRET) {
    res.status(500).json({ error: "Variables d'environnement manquantes" });
    return;
  }
  if (req.method !== "POST" || req.headers["x-telegram-bot-api-secret-token"] !== TELEGRAM_WEBHOOK_SECRET) {
    res.status(401).json({ error: "Non autorisé" });
    return;
  }

  let update = req.body;
  if (typeof update === "string") { try { update = JSON.parse(update); } catch (e) { update = {}; } }
  const msg = update && update.message;

  try {
    if (msg && msg.chat && msg.chat.type === "private") {
      const chatId = msg.chat.id;
      const text = (msg.text || "").trim();
      if (/^\/start\b/.test(text)) {
        const name = msg.from && msg.from.first_name ? " " + esc(msg.from.first_name) : "";
        await tg("sendPhoto", {
          chat_id: chatId,
          photo: IMAGE_URL,
          parse_mode: "HTML",
          caption:
            `👽 Salut${name}, bienvenue chez <b>Star'Farms 51</b> !\n\n` +
            `🚀 Livraison et meet-up à Reims\n\n` +
            `Appuie sur <b>STAR'FARMS MENU</b> pour ouvrir la boutique 👇`,
          reply_markup: KEYBOARD
        });
      } else {
        await tg("sendMessage", {
          chat_id: chatId,
          text: "👽 Pour commander, ouvre la boutique avec le bouton ci-dessous.\nPour une question, écris-nous via Contact.",
          reply_markup: KEYBOARD
        });
      }
    }
  } catch (e) {
    console.error("bot:", e.message);
  }
  // Toujours 200 pour que Telegram ne renvoie pas le même message en boucle
  res.status(200).json({ ok: true });
};
