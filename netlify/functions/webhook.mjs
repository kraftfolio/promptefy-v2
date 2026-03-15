import { getStore } from "@netlify/blobs";
import { createClient } from "@supabase/supabase-js";

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);

// Init Supabase with Service Role to bypass RLS for admin/bot actions
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

// ── Telegram API ────────────────────────────────────────

async function tg(method, body) {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return res.json();
}

async function send(chatId, text, opts = {}) {
    return tg("sendMessage", { chat_id: chatId, text, ...opts });
}

// ── Image Helpers ───────────────────────────────────────

async function downloadAndStorePhoto(fileId) {
    const fileInfo = await tg("getFile", { file_id: fileId });
    if (!fileInfo.ok || !fileInfo.result.file_path) return null;
    const filePath = fileInfo.result.file_path;
    const ext = filePath.split(".").pop() || "jpg";
    const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
    const res = await fetch(downloadUrl);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const imageStore = getStore("images");
    await imageStore.set(filename, new Uint8Array(buffer));
    return `/api/image/${filename}`;
}

// ── Storage ─────────────────────────────────────────────

const dataStore = () => getStore("data");
const userStore = () => getStore("users");

async function getBanners() { try { const r = await dataStore().get("banners"); return r ? JSON.parse(r) : []; } catch { return []; } }
async function saveBanners(b) { await dataStore().set("banners", JSON.stringify(b)); }

// Get linked user for telegram ID
async function getLinkedUser(telegramId) {
    try {
        const uidKey = await userStore().get("tg_" + telegramId);
        if (!uidKey) return null;
        const raw = await userStore().get(uidKey);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

// ── Session State (in Blobs for serverless) ─────────────
async function getState(telegramId) {
    try {
        const raw = await dataStore().get(`tg_state_${telegramId}`);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

async function setState(telegramId, state) {
    await dataStore().set(`tg_state_${telegramId}`, JSON.stringify(state));
}

async function clearState(telegramId) {
    try { await dataStore().delete(`tg_state_${telegramId}`); } catch {}
}

// ── Password hashing ───────────────────────────────────
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "_promptefy_salt_2026");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Keyboards ───────────────────────────────────────────

const LOGIN_KB = {
    inline_keyboard: [
        [{ text: "🔐 Sign In", callback_data: "cb_login" }],
        [{ text: "🌐 Sign Up on Website", url: "https://promptefy-final.netlify.app" }],
    ],
};

function getMenuKB(userId) {
    const kb = [
        [{ text: "✨ New Prompt" }, { text: "📚 My Library" }],
        [{ text: "🗑 Delete" }, { text: "⚙️ Profile" }],
        [{ text: "🏷 Help" }],
    ];
    if (userId === ADMIN_ID) {
        kb.push([{ text: "🖼 Banners" }, { text: "📌 Pin" }]);
    }
    return { keyboard: kb, resize_keyboard: true, is_persistent: true };
}

const BACK_KB = { inline_keyboard: [[{ text: "← Back to Menu", callback_data: "cb_menu" }]] };
const SKIP_KB = { inline_keyboard: [[{ text: "⏭ Skip", callback_data: "cb_skip" }]] };
const CANCEL_KB = { inline_keyboard: [[{ text: "❌ Cancel", callback_data: "cb_cancel_upload" }]] };

const SOFTWARE_KB = {
    inline_keyboard: [
        [{ text: "Sora", callback_data: "sw_sora" }, { text: "Runway", callback_data: "sw_runway" }],
        [{ text: "Midjourney", callback_data: "sw_midjourney" }, { text: "DALL·E", callback_data: "sw_dalle" }],
        [{ text: "Flux", callback_data: "sw_flux" }, { text: "Gemini", callback_data: "sw_gemini" }],
        [{ text: "ChatGPT", callback_data: "sw_chatgpt" }, { text: "Other", callback_data: "sw_other" }],
        [{ text: "❌ Cancel", callback_data: "cb_cancel_upload" }],
    ],
};

// ══════════════════════════════════════════════════════════
// WEBHOOK HANDLER
// ══════════════════════════════════════════════════════════

export default async (req) => {
    try {
        if (req.method !== "POST") return new Response("OK");
        const update = await req.json();

        // ── CALLBACK QUERIES ──────────────────────
        if (update.callback_query) {
            const q = update.callback_query;
            const chatId = q.message.chat.id;
            const userId = q.from.id;
            const action = q.data;
            await tg("answerCallbackQuery", { callback_query_id: q.id });

            const linkedUser = await getLinkedUser(userId);
            const state = await getState(userId);

            // ── Login flow ──────────────────────
            if (action === "cb_login") {
                await setState(userId, { step: "login_email" });
                await send(chatId, "📧 *Enter your email:*\n\n_Use the same email you registered on the website._", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }

            // ── Cancel login/upload ─────────────
            if (action === "cb_cancel_upload") {
                await clearState(userId);
                if (linkedUser) {
                    await send(chatId, "❌ Cancelled.", { reply_markup: getMenuKB(userId) });
                } else {
                    await send(chatId, "❌ Cancelled.\n\n🔐 Sign in to start using Promptefy Bot.", { reply_markup: LOGIN_KB });
                }
                return new Response("OK");
            }

            // ── Skip (title) ────────────────────
            if (action === "cb_skip" && state) {
                if (state.step === "upload_title") {
                    state.title = "Untitled Prompt";
                    state.step = "upload_tags";
                    await setState(userId, state);
                    await send(chatId, "🏷 *Enter tags* (comma separated):\n\nExample: `cinematic, nature, 4k`", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                    return new Response("OK");
                }
            }

            // ── Software selection ──────────────
            if (action.startsWith("sw_") && state && state.step === "upload_software") {
                state.software = action.substring(3);
                state.step = "upload_prompt";
                await setState(userId, state);
                await send(chatId, `✅ Software: *${state.software}*\n\n📝 *Now enter your prompt text:*`, { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }

            // ── Publish ─────────────────────────
            if (action === "cb_publish" && state && state.step === "upload_preview") {
                const post = {
                    id: Date.now().toString(36),
                    function: state.title,
                    tags: state.tags || [],
                    prompt: state.prompt,
                    image: state.afterImage || null,
                    before_image: state.beforeImage || null,
                    after_image: state.afterImage || null,
                    software: state.software || null,
                    pinned: false,
                    author: linkedUser.name,
                    author_id: userId,
                    date: new Date().toISOString(),
                };
                const { error } = await supabase.from("prompts").insert(post);
                if (error) { await send(chatId, "❌ Error publishing to Supabase: " + error.message); return new Response("OK"); }
                
                await clearState(userId);
                await send(chatId, "✅ *Published!*\n━━━━━━━━━━━━━━━━━━━━\n\nYour prompt is now live on the website.", { parse_mode: "Markdown", reply_markup: getMenuKB(userId) });
                return new Response("OK");
            }

            if (action === "cb_discard") {
                await clearState(userId);
                await send(chatId, "🗑 Draft discarded.", { reply_markup: getMenuKB(userId) });
                return new Response("OK");
            }

            // ── Must be logged in ───────────────
            if (!linkedUser) {
                await send(chatId, "🔐 *Please sign in first*\n━━━━━━━━━━━━━━━━━━━━\n\nSign up on the website, then sign in here.", { parse_mode: "Markdown", reply_markup: LOGIN_KB });
                return new Response("OK");
            }

            // ── Menu / Navigation ───────────────
            if (action === "cb_menu") {
                await clearState(userId);
                await send(chatId, `🚀 *Welcome, ${linkedUser.name}!*\n━━━━━━━━━━━━━━━━━━━━\n\n👇 *Choose an action:*`, { parse_mode: "Markdown", reply_markup: getMenuKB(userId) });
                return new Response("OK");
            }

            if (action === "cb_post") {
                await setState(userId, { step: "upload_before" });
                await send(chatId, "📸 *Step 1/6 — Before Image*\n━━━━━━━━━━━━━━━━━━━━\n\nSend the *before* image (the input/reference).", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }

            if (action === "cb_list") {
                const { data: my, error } = await supabase.from("prompts").select("*").eq("author_id", userId).order("date", { ascending: false });
                if (error) { await send(chatId, "❌ Error loading library."); return new Response("OK"); }
                if (!my || my.length === 0) {
                    await send(chatId, "📭 *Your library is empty.*", { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "✨ Create First Prompt", callback_data: "cb_post" }], [{ text: "← Menu", callback_data: "cb_menu" }]] } });
                    return new Response("OK");
                }
                let t = `📚 *Your Library* (${my.length})\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                const kb = { inline_keyboard: [] };
                my.forEach((p, i) => {
                    const pin = p.pinned ? "📌 " : "";
                    t += `${i + 1}. ${pin}*${p.function}*\n`;
                    kb.inline_keyboard.push([{ text: `📝 ${p.function}`, callback_data: `cb_view_${p.id}` }]);
                });
                kb.inline_keyboard.push([{ text: "← Menu", callback_data: "cb_menu" }]);
                await send(chatId, t, { parse_mode: "Markdown", reply_markup: kb });
                return new Response("OK");
            }

            if (action === "cb_delete_list") {
                const { data: my, error } = await supabase.from("prompts").select("*").eq("author_id", userId);
                if (error || !my || my.length === 0) { await send(chatId, "📭 Nothing to delete.", { reply_markup: BACK_KB }); return new Response("OK"); }
                let t = `🗑 *Select to Delete*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                const kb = { inline_keyboard: [] };
                my.forEach((p) => { kb.inline_keyboard.push([{ text: `🗑 ${p.function}`, callback_data: `cb_del_${p.id}` }]); });
                kb.inline_keyboard.push([{ text: "← Menu", callback_data: "cb_menu" }]);
                await send(chatId, t, { parse_mode: "Markdown", reply_markup: kb });
                return new Response("OK");
            }

            if (action.startsWith("cb_del_")) {
                const targetId = action.substring(7);
                const { error } = await supabase.from("prompts").delete().eq("id", targetId).or(`author_id.eq.${userId},author_id.eq.${ADMIN_ID}`);
                if (!error) {
                    await send(chatId, `🗑 *Deleted successfully*`, { parse_mode: "Markdown", reply_markup: BACK_KB });
                } else { await send(chatId, "❌ Error deleting or not found.", { reply_markup: BACK_KB }); }
                return new Response("OK");
            }

            if (action === "cb_profile") {
                await send(chatId, `⚙️ *Profile*\n━━━━━━━━━━━━━━━━━━━━\n\nName: *${linkedUser.name}*\nEmail: \`${linkedUser.email}\`\nTelegram ID: \`${userId}\``, { parse_mode: "Markdown", reply_markup: BACK_KB });
                return new Response("OK");
            }

            if (action === "cb_help") {
                let t = "📖 *Help*\n━━━━━━━━━━━━━━━━━━━━\n\n• Use ✨ New Prompt to start step-by-step upload\n• Each prompt needs before/after images\n• Tags help people discover your prompt";
                if (userId === ADMIN_ID) t += "\n\n⚡ *Admin:*\n• 🖼 Banners — manage hero banners\n• 📌 Pin — pin prompts as trending";
                await send(chatId, t, { parse_mode: "Markdown", reply_markup: BACK_KB });
                return new Response("OK");
            }

            // ── Admin: Banners ──────────────────
            if (action === "cb_admin_banners" && userId === ADMIN_ID) {
                const banners = await getBanners();
                let t = `🖼 *Banners* (${banners.length}/4)\n━━━━━━━━━━━━━━━━━━━━\n\n`;
                if (!banners.length) t += "No banners active.";
                const kb = { inline_keyboard: banners.map((b, i) => [{ text: `🗑 ${b.title}`, callback_data: `cb_delbanner_${i}` }]) };
                if (banners.length < 4) kb.inline_keyboard.push([{ text: "➕ Add Banner", callback_data: "cb_add_banner" }]);
                kb.inline_keyboard.push([{ text: "← Back", callback_data: "cb_menu" }]);
                await send(chatId, t, { parse_mode: "Markdown", reply_markup: kb });
                return new Response("OK");
            }

            if (action === "cb_add_banner" && userId === ADMIN_ID) {
                await setState(userId, { step: "banner_title" });
                await send(chatId, "🖼 *Step 1/2 — Banner Title*\n\nWhat should the banner text say?", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }

            if (action.startsWith("cb_delbanner_") && userId === ADMIN_ID) {
                const idx = parseInt(action.substring(13));
                const banners = await getBanners();
                if (banners[idx]) { banners.splice(idx, 1); await saveBanners(banners); await send(chatId, "🗑 *Banner deleted.*", { parse_mode: "Markdown", reply_markup: BACK_KB }); }
                return new Response("OK");
            }

            if (action === "cb_admin_pin" && userId === ADMIN_ID) {
                const kb = { inline_keyboard: [
                    [{ text: "📌 Pin New Prompt", callback_data: "cb_admin_pin_list" }],
                    [{ text: "🗑 Unpin Prompt", callback_data: "cb_admin_unpin_list" }],
                    [{ text: "← Menu", callback_data: "cb_menu" }]
                ]};
                await send(chatId, "📋 *Pin Management*", { parse_mode: "Markdown", reply_markup: kb });
                return new Response("OK");
            }

            if (action === "cb_admin_pin_list" && userId === ADMIN_ID) {
                const { data: unpinned, error } = await supabase.from("prompts").select("*").eq("pinned", false).limit(15);
                if (error || !unpinned || unpinned.length === 0) { await send(chatId, "📭 No unpinned posts available.", { reply_markup: BACK_KB }); return new Response("OK"); }
                const kb = { inline_keyboard: [] };
                unpinned.forEach(p => kb.inline_keyboard.push([{ text: "📌 " + p.function, callback_data: `cb_togglepin_${p.id}` }]));
                kb.inline_keyboard.push([{ text: "← Back", callback_data: "cb_admin_pin" }]);
                await send(chatId, "📌 *Select to Pin:*", { parse_mode: "Markdown", reply_markup: kb });
                return new Response("OK");
            }

            if (action === "cb_admin_unpin_list" && userId === ADMIN_ID) {
                const { data: pinned, error } = await supabase.from("prompts").select("*").eq("pinned", true);
                if (error || !pinned || pinned.length === 0) { await send(chatId, "📭 No pinned posts.", { reply_markup: BACK_KB }); return new Response("OK"); }
                const kb = { inline_keyboard: [] };
                pinned.forEach(p => kb.inline_keyboard.push([{ text: "🗑 " + p.function, callback_data: `cb_togglepin_${p.id}` }]));
                kb.inline_keyboard.push([{ text: "← Back", callback_data: "cb_admin_pin" }]);
                await send(chatId, "🗑 *Select to Unpin:*", { parse_mode: "Markdown", reply_markup: kb });
                return new Response("OK");
            }

            if (action.startsWith("cb_togglepin_") && userId === ADMIN_ID) {
                const postId = action.substring(13);
                const { data: post } = await supabase.from("prompts").select("pinned, function").eq("id", postId).single();
                if (post) {
                    const { error } = await supabase.from("prompts").update({ pinned: !post.pinned }).eq("id", postId);
                    if (!error) await send(chatId, `${!post.pinned ? "📌 Pinned" : "Unpinned"}: *${post.function}*`, { parse_mode: "Markdown", reply_markup: { inline_keyboard: [[{ text: "← Back", callback_data: "cb_admin_pin" }]] } });
                }
                return new Response("OK");
            }

            return new Response("OK");
        }

        // ── MESSAGES ────────────────────────────
        const msg = update.message;
        if (!msg) return new Response("OK");
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = (msg.text || "").trim();
        const linkedUser = await getLinkedUser(userId);
        const state = await getState(userId);

        // ── Login state machine ─────────────────
        if (state && state.step === "login_email") {
            if (!text || !text.includes("@")) {
                await send(chatId, "❌ Please enter a valid email.", { reply_markup: CANCEL_KB });
                return new Response("OK");
            }
            state.loginEmail = text.toLowerCase();
            state.step = "login_password";
            await setState(userId, state);
            await send(chatId, "🔑 *Enter your password:*", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
            return new Response("OK");
        }

        if (state && state.step === "login_password") {
            if (!text) { await send(chatId, "❌ Please enter your 6-digit code.", { reply_markup: CANCEL_KB }); return new Response("OK"); }
            if (!supabase) { await send(chatId, "❌ Auth system offline.", { reply_markup: CANCEL_KB }); return new Response("OK"); }

            await send(chatId, "⏳ Verifying...", { reply_markup: CANCEL_KB });

            const { data, error } = await supabase.auth.verifyOtp({ email: state.loginEmail, token: text.trim(), type: 'email' });

            if (error || !data.user) {
                await send(chatId, `❌ *Verification Failed*: ${error?.message || "Invalid code"}\nTry logging in again.`, { parse_mode: "Markdown", reply_markup: LOGIN_KB });
                await clearState(userId);
                return new Response("OK");
            }

            // Sync user state down to blobs for the bot
            const userMeta = data.user.user_metadata || {};
            const user = {
                uid: data.user.id,
                email: data.user.email,
                name: userMeta.full_name || data.user.email.split('@')[0],
                telegramLinked: true,
                telegramId: userId,
                saved: [],
                likes: []
            };

            const store = userStore();
            const existingRaw = await store.get(user.uid);
            if (existingRaw) {
                const existing = JSON.parse(existingRaw);
                user.saved = existing.saved || [];
                user.likes = existing.likes || [];
            }

            await store.set(user.uid, JSON.stringify(user));
            await store.set("tg_" + userId, user.uid);
            await store.set("email_" + user.email, user.uid);
            await clearState(userId);

            await send(chatId, `✅ *Signed in as ${user.name}!*\n━━━━━━━━━━━━━━━━━━━━\n\nYou can now upload prompts and manage your library.\n\n👇 *Quick Menu:*`, { parse_mode: "Markdown", reply_markup: getMenuKB(userId) });
            return new Response("OK");
        }

        // ── Step-by-step upload state machine ───
        if (state && linkedUser) {
            // Step 1: Before image
            if (state.step === "upload_before") {
                if (!msg.photo || msg.photo.length === 0) {
                    await send(chatId, "📸 Please send a *photo* (before image).", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                    return new Response("OK");
                }
                const bestPhoto = msg.photo[msg.photo.length - 1];
                const url = await downloadAndStorePhoto(bestPhoto.file_id);
                state.beforeImage = url;
                state.step = "upload_after";
                await setState(userId, state);
                await send(chatId, "✅ Before image saved!\n\n📸 *Step 2/6 — After Image*\n━━━━━━━━━━━━━━━━━━━━\n\nNow send the *after* image (the AI output).", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }

            // Step 2: After image
            if (state.step === "upload_after") {
                if (!msg.photo || msg.photo.length === 0) {
                    await send(chatId, "📸 Please send a *photo* (after image).", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                    return new Response("OK");
                }
                const bestPhoto = msg.photo[msg.photo.length - 1];
                const url = await downloadAndStorePhoto(bestPhoto.file_id);
                state.afterImage = url;
                state.step = "upload_title";
                await setState(userId, state);
                await send(chatId, "✅ After image saved!\n\n✏️ *Step 3/6 — Title*\n━━━━━━━━━━━━━━━━━━━━\n\nEnter a title for your prompt, or skip.", { parse_mode: "Markdown", reply_markup: SKIP_KB });
                return new Response("OK");
            }

            // Step 3: Title
            if (state.step === "upload_title") {
                state.title = text || "Untitled Prompt";
                state.step = "upload_tags";
                await setState(userId, state);
                await send(chatId, `✅ Title: *${state.title}*\n\n🏷 *Step 4/6 — Tags*\n━━━━━━━━━━━━━━━━━━━━\n\nEnter tags separated by commas.\nExample: \`cinematic, nature, 4k\``, { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }

            // Step 4: Tags
            if (state.step === "upload_tags") {
                state.tags = text.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
                state.step = "upload_software";
                await setState(userId, state);
                await send(chatId, "✅ Tags saved!\n\n🖥 *Step 5/6 — Software*\n━━━━━━━━━━━━━━━━━━━━\n\nWhich AI software was used?", { parse_mode: "Markdown", reply_markup: SOFTWARE_KB });
                return new Response("OK");
            }

            // Step 6: Prompt text
            if (state.step === "upload_prompt") {
                if (!text) { await send(chatId, "📝 Please enter the prompt text.", { reply_markup: CANCEL_KB }); return new Response("OK"); }
                state.prompt = text;
                state.step = "upload_preview";
                await setState(userId, state);

                const preview = `👀 *Preview Your Prompt*\n━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `📌 *${state.title}*\n` +
                    `🏷 Tags: _${(state.tags || []).join(", ")}_\n` +
                    `🖥 Software: _${state.software}_\n` +
                    `📸 Before/After images attached\n\n` +
                    `📝 Prompt:\n\`\`\`\n${state.prompt.substring(0, 200)}${state.prompt.length > 200 ? "..." : ""}\n\`\`\`\n\n` +
                    `👇 *Ready to publish?*`;

                await send(chatId, preview, {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Publish", callback_data: "cb_publish" }],
                            [{ text: "🗑 Discard", callback_data: "cb_discard" }],
                        ],
                    },
                });
                return new Response("OK");
            }
        }

        // Banner upload flow (Admin)
        if (state && userId === ADMIN_ID) {
            if (state.step === "banner_title") {
                state.bannerTitle = text || "New Banner";
                state.step = "banner_photo";
                await setState(userId, state);
                await send(chatId, `✅ Title: *${state.bannerTitle}*\n\n📸 *Step 2/2 — Photo*\nSend the banner image.`, { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }
            if (state.step === "banner_photo") {
                if (!msg.photo) { await send(chatId, "📸 Please send a photo.", { reply_markup: CANCEL_KB }); return new Response("OK"); }
                const photoUrl = await downloadAndStorePhoto(msg.photo[msg.photo.length - 1].file_id);
                const banners = await getBanners();
                banners.push({ image: photoUrl, title: state.bannerTitle, tag: "NEW", date: new Date().toISOString() });
                await saveBanners(banners);
                await clearState(userId);
                await send(chatId, `✅ *Banner Added:* "${state.bannerTitle}"`, { parse_mode: "Markdown", reply_markup: BACK_KB });
                return new Response("OK");
            }
        }

        // ── Not logged in ───────────────────────
        if (!linkedUser) {
            if (text === "/start") {
                await send(chatId, `🎨 *Welcome to Promptefy Bot*\n━━━━━━━━━━━━━━━━━━━━\n\nShare AI prompts with before/after results.\n\n🔐 *Sign in to get started:*\n_Sign up on the website first, then sign in here._`, { parse_mode: "Markdown", reply_markup: LOGIN_KB });
                return new Response("OK");
            }
            await send(chatId, "🔐 Please sign in first.", { reply_markup: LOGIN_KB });
            return new Response("OK");
        }

        // ── Commands (logged in) ────────────────
        if (text === "/start") {
            await clearState(userId);
            await send(chatId, `🚀 *Welcome, ${linkedUser.name}!*\n━━━━━━━━━━━━━━━━━━━━\n\n👇 *Choose an action:*`, { parse_mode: "Markdown", reply_markup: getMenuKB(userId) });
            return new Response("OK");
        }

        // Persistent Menu Keyboard Handlers
        if (text === "✨ New Prompt") {
            await setState(userId, { step: "upload_before" });
            await send(chatId, "📸 *Step 1/6 — Before Image*\n━━━━━━━━━━━━━━━━━━━━\n\nSend the *before* image (the input/reference).", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
            return new Response("OK");
        }
        
        if (text === "📚 My Library") {
            const { data: my, error } = await supabase.from("prompts").select("*").eq("author_id", userId).order("date", { ascending: false });
            if (error || !my || my.length === 0) {
                await send(chatId, "📭 *Your library is empty.*", { parse_mode: "Markdown", reply_markup: BACK_KB });
                return new Response("OK");
            }
            let t = `📚 *Your Library* (${my.length})\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            const kb = { inline_keyboard: [] };
            my.forEach((p, i) => {
                const pin = p.pinned ? "📌 " : "";
                t += `${i + 1}. ${pin}*${p.function}*\n`;
                kb.inline_keyboard.push([{ text: `📝 ${p.function}`, callback_data: `cb_view_${p.id}` }]);
            });
            kb.inline_keyboard.push([{ text: "← Menu", callback_data: "cb_menu" }]);
            await send(chatId, t, { parse_mode: "Markdown", reply_markup: kb });
            return new Response("OK");
        }

        if (text === "🗑 Delete") {
            const { data: my } = await supabase.from("prompts").select("*").eq("author_id", userId);
            if (!my || my.length === 0) { await send(chatId, "📭 Nothing to delete.", { reply_markup: BACK_KB }); return new Response("OK"); }
            let t = `🗑 *Select to Delete*\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            const kb = { inline_keyboard: [] };
            my.forEach((p) => { kb.inline_keyboard.push([{ text: `🗑 ${p.function}`, callback_data: `cb_del_${p.id}` }]); });
            kb.inline_keyboard.push([{ text: "← Menu", callback_data: "cb_menu" }]);
            await send(chatId, t, { parse_mode: "Markdown", reply_markup: kb });
            return new Response("OK");
        }

        if (text === "⚙️ Profile") {
            await send(chatId, `👤 *Your Profile*\n━━━━━━━━━━━━━━━━━━━━\n\n*Name:* ${linkedUser.name}\n*Email:* ${linkedUser.email}\n*Joined:* ${new Date(linkedUser.joined).toLocaleDateString()}`, { parse_mode: "Markdown", reply_markup: BACK_KB });
            return new Response("OK");
        }

        if (text === "🏷 Help") {
            await send(chatId, `🏷 *Help & Guide*\n━━━━━━━━━━━━━━━━━━━━\n\nUpload before and after photos of your AI generations and share the prompts that created them!\n\nUse ✨ *New Prompt* to start.`, { parse_mode: "Markdown", reply_markup: BACK_KB });
            return new Response("OK");
        }

        if (text === "🖼 Banners" && userId === ADMIN_ID) {
            const banners = await getBanners();
            if (banners.length === 0) {
                await setState(userId, { step: "banner_title" });
                await send(chatId, "📭 No banners found. Let's add one.\n\n✏️ *Step 1/2 — Title*", { parse_mode: "Markdown", reply_markup: CANCEL_KB });
                return new Response("OK");
            }
            const kb = { inline_keyboard: [] };
            banners.forEach((x, i) => kb.inline_keyboard.push([{ text: `🗑 ${x.title}`, callback_data: `cb_delbanner_${i}` }]));
            kb.inline_keyboard.push([{ text: "➕ Add Banner", callback_data: "cb_add_banner" }]);
            await send(chatId, "🖼 *Manage Promptefy Banners*\n━━━━━━━━━━━━━━━━━━━━", { parse_mode: "Markdown", reply_markup: kb });
            return new Response("OK");
        }

        if (text === "📌 Pin" && userId === ADMIN_ID) {
            const { data: posts } = await supabase.from("prompts").select("*").order("date", { ascending: false }).limit(20);
            if (!posts) return new Response("OK");
            const kb = { inline_keyboard: [] };
            posts.forEach((p) => {
                const icon = p.pinned ? "📌" : "📍";
                kb.inline_keyboard.push([{ text: `${icon} ${p.function}`, callback_data: `cb_pin_${p.id}` }]);
            });
            await send(chatId, "📌 *Select a prompt to toggle pin state*\n━━━━━━━━━━━━━━━━━━━━", { parse_mode: "Markdown", reply_markup: kb });
            return new Response("OK");
        }

        // Admin: banner via photo
        if (msg.photo && msg.photo.length > 0 && userId === ADMIN_ID && !state) {
            const caption = (msg.caption || "").trim();
            if (caption.toLowerCase().startsWith("banner:")) {
                const title = caption.substring(7).trim();
                if (!title) { await send(chatId, "❌ Use: `banner: Title`", { parse_mode: "Markdown" }); return new Response("OK"); }
                const banners = await getBanners();
                if (banners.length >= 4) { await send(chatId, "❌ Max 4 banners. Delete one first."); return new Response("OK"); }
                const bestPhoto = msg.photo[msg.photo.length - 1];
                const url = await downloadAndStorePhoto(bestPhoto.file_id);
                banners.push({ image: url, title, tag: "New", date: new Date().toISOString() });
                await saveBanners(banners);
                await send(chatId, `✅ *Banner added:* "${title}"`, { parse_mode: "Markdown", reply_markup: BACK_KB });
                return new Response("OK");
            }
        }

        // Admin commands
        if (userId === ADMIN_ID) {
            if (text.startsWith("/pin ")) {
                const id = text.split(" ")[1];
                const { error } = await supabase.from("prompts").update({ pinned: true }).eq("id", id);
                if (!error) await send(chatId, `📌 Pinned: *${id}*`, { parse_mode: "Markdown" });
                return new Response("OK");
            }
            if (text.startsWith("/unpin ")) {
                const id = text.split(" ")[1];
                const { error } = await supabase.from("prompts").update({ pinned: false }).eq("id", id);
                if (!error) await send(chatId, `Unpinned: *${id}*`, { parse_mode: "Markdown" });
                return new Response("OK");
            }
        }

        return new Response("OK");
    } catch (err) {
        console.error("Webhook Error:", err);
        return new Response("Error: " + err.message, { status: 500 });
    }
};

export const config = { path: "/api/webhook" };
