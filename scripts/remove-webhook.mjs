// Removes the Telegram webhook (switches bot back to polling for local dev).
// Usage: node scripts/remove-webhook.mjs <BOT_TOKEN>

const BOT_TOKEN = process.argv[2];

if (!BOT_TOKEN) {
    console.log("Usage: node scripts/remove-webhook.mjs <BOT_TOKEN>");
    process.exit(1);
}

const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`
);
const data = await res.json();

if (data.ok) {
    console.log("✅ Webhook removed. Bot is back to polling mode for local dev.");
} else {
    console.log(`❌ Failed: ${data.description}`);
}
