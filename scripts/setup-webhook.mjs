// Sets the Telegram webhook URL to your deployed Netlify site.
// Usage: node scripts/setup-webhook.mjs <BOT_TOKEN> <NETLIFY_SITE_URL>
// Example: node scripts/setup-webhook.mjs 123456:ABC https://your-site.netlify.app

const BOT_TOKEN = process.argv[2];
const SITE_URL = process.argv[3];

if (!BOT_TOKEN || !SITE_URL) {
    console.log("Usage: node scripts/setup-webhook.mjs <BOT_TOKEN> <SITE_URL>");
    console.log("Example: node scripts/setup-webhook.mjs 123456:ABC https://my-site.netlify.app");
    process.exit(1);
}

const webhookUrl = `${SITE_URL.replace(/\/$/, "")}/api/webhook`;

const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
);
const data = await res.json();

if (data.ok) {
    console.log(`✅ Webhook set → ${webhookUrl}`);
} else {
    console.log(`❌ Failed: ${data.description}`);
}
