require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = Number(process.env.ADMIN_ID);
const PORT = process.env.PORT || 3000;

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY);

const BANNERS_FILE = path.join(__dirname, 'banners.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const COMMENTS_DIR = path.join(__dirname, 'comments');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

[COMMENTS_DIR, UPLOADS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── Helpers ─────────────────────────────────────────────

function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return file.includes('users') ? {} : []; } }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); }

function hashPassword(pw) { return crypto.createHash('sha256').update(pw + '_promptefy_salt_2026').digest('hex'); }
function genToken() { return Date.now().toString(36) + '_' + crypto.randomBytes(8).toString('hex'); }

// ── Express ─────────────────────────────────────────────

const app = express();
const { google } = require('googleapis');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Google Sheets Helper ────────────────────────────────

// API: Posts
app.get('/api/posts', async (_req, res) => {
  const { data, error } = await supabase.from('prompts').select('*').order('date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  
  // Map snake_case to camelCase for frontend compatibility
  const mapped = data.map(p => ({
    ...p,
    beforeImage: p.before_image,
    afterImage: p.after_image
  }));
  
  res.json(mapped);
});

// API: Banners
app.get('/api/banners', (_req, res) => {
  const banners = readJSON(BANNERS_FILE) || [];
  res.json(banners);
});

// API: Auth
// Config endpoint for frontend keys
app.get('/api/config', (req, res) => {
  res.json({ SUPABASE_URL: process.env.SUPABASE_URL || "", SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "" });
});

app.post('/api/auth', async (req, res) => {
  const { action, email, password, name, token, telegramId } = req.body;
  const users = readJSON(USERS_FILE);

  if (action === 'sync_session') {
    if (!token || !email || !uid) return res.status(400).json({ error: 'Supabase Session required' });
    
    // Update token on fresh login
    if (!users[uid]) {
      users[uid] = { uid, email: email.toLowerCase(), name: name || email.split('@')[0], token, saved: [], likes: [], telegramLinked: false, telegramId: null, joined: new Date().toISOString() };
      users['email_' + email.toLowerCase()] = uid;
    } else {
      users[uid].token = token;
    }
    writeJSON(USERS_FILE, users);
    
    const u = users[uid];
    return res.json({ ok: true, user: { uid: u.uid, email: u.email, name: u.name, saved: u.saved, likes: u.likes, token: u.token } });
  } else if (action === 'verify') {
    if (!token || !email) return res.json({ valid: false });
    const uidKey = users['email_' + email.toLowerCase()];
    if (!uidKey || !users[uidKey]) return res.json({ valid: false });
    res.json({ valid: users[uidKey].token === token, user: users[uidKey] ? { uid: users[uidKey].uid, email: users[uidKey].email, name: users[uidKey].name, saved: users[uidKey].saved, likes: users[uidKey].likes, token } : null });
  } else if (action === 'telegram_login') {
    if (!email || !password || !telegramId) return res.status(400).json({ error: 'All fields required' });
    const uidKey = users['email_' + email.toLowerCase()];
    if (!uidKey || !users[uidKey]) return res.status(404).json({ error: 'Account not found' });
    const u = users[uidKey];
    if (u.password !== hashPassword(password)) return res.status(401).json({ error: 'Wrong password' });
    u.telegramLinked = true; u.telegramId = telegramId;
    users['tg_' + telegramId] = uidKey;
    writeJSON(USERS_FILE, users);
    res.json({ ok: true, name: u.name });
  } else { res.status(400).json({ error: 'Invalid action' }); }
});

// API: User Data
app.get('/api/userdata', (req, res) => {
  const uid = req.query.uid;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });
  const users = readJSON(USERS_FILE);
  if (!users[uid]) return res.status(404).json({ error: 'Not found' });
  res.json(users[uid]);
});

app.post('/api/userdata', (req, res) => {
  const { uid, action, postId } = req.body;
  if (!uid || !action || !postId) return res.status(400).json({ error: 'Missing fields' });
  const users = readJSON(USERS_FILE);
  if (!users[uid]) return res.status(404).json({ error: 'Not found' });
  const p = users[uid];
  if (action === 'save') { if (!p.saved) p.saved = []; if (!p.saved.includes(postId)) p.saved.push(postId); }
  else if (action === 'unsave') { p.saved = (p.saved || []).filter(id => id !== postId); }
  else if (action === 'like') { if (!p.likes) p.likes = []; if (!p.likes.includes(postId)) p.likes.push(postId); }
  else if (action === 'unlike') { p.likes = (p.likes || []).filter(id => id !== postId); }
  writeJSON(USERS_FILE, users);
  const likeCount = Object.values(users).filter(u => u.likes && u.likes.includes(postId)).length;
  res.json({ ok: true, user: p, likeCount });
});

// API: Comments
app.get('/api/comments', (req, res) => {
  const postId = req.query.post;
  if (!postId) return res.status(400).json({ error: 'Missing post' });
  const file = path.join(COMMENTS_DIR, `${postId}.json`);
  try { res.json(JSON.parse(fs.readFileSync(file, 'utf-8'))); } catch { res.json([]); }
});

app.post('/api/comments', (req, res) => {
  const { postId, uid, name, text } = req.body;
  if (!postId || !uid || !text) return res.status(400).json({ error: 'Missing fields' });
  const file = path.join(COMMENTS_DIR, `${postId}.json`);
  let comments = [];
  try { comments = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { comments = []; }
  comments.push({ id: Date.now().toString(36), uid, name: name || 'Anonymous', text: text.substring(0, 500), date: new Date().toISOString() });
  if (comments.length > 100) comments = comments.slice(-100);
  fs.writeFileSync(file, JSON.stringify(comments, null, 2));
  res.json({ ok: true, comments });
});

app.post('/api/analytics', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Server → http://localhost:${PORT}`));

// ── Telegram Bot ────────────────────────────────────────

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const botStates = {}; // per-user state machine

function getMenuKB(userId) {
  const kb = [
    [{ text: '✨ New Prompt' }, { text: '📚 My Library' }],
    [{ text: '🗑 Delete' }, { text: '⚙️ Profile' }],
    [{ text: '🏷 Help' }],
  ];
  if (userId === ADMIN_ID) kb.push([{ text: '🖼 Banners' }, { text: '📌 Pin' }]);
  return { keyboard: kb, resize_keyboard: true, is_persistent: true };
}
const BACK_KB = { inline_keyboard: [[{ text: '← Menu', callback_data: 'cb_menu' }]] };
const LOGIN_KB = { inline_keyboard: [[{ text: '🔐 Sign In', callback_data: 'cb_login' }], [{ text: '🌐 Sign Up', url: 'https://promptefy-final.netlify.app' }]] };
const CANCEL_KB = { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cb_cancel_upload' }]] };
const SKIP_KB = { inline_keyboard: [[{ text: '⏭ Skip', callback_data: 'cb_skip' }]] };
const SOFTWARE_KB = { inline_keyboard: [
  [{ text: 'Sora', callback_data: 'sw_sora' }, { text: 'Runway', callback_data: 'sw_runway' }],
  [{ text: 'Midjourney', callback_data: 'sw_midjourney' }, { text: 'DALL·E', callback_data: 'sw_dalle' }],
  [{ text: 'Flux', callback_data: 'sw_flux' }, { text: 'Gemini', callback_data: 'sw_gemini' }],
  [{ text: 'ChatGPT', callback_data: 'sw_chatgpt' }, { text: 'Other', callback_data: 'sw_other' }],
  [{ text: '❌ Cancel', callback_data: 'cb_cancel_upload' }],
]};

function getLinkedUser(userId) {
  const users = readJSON(USERS_FILE);
  const uidKey = users['tg_' + userId];
  return uidKey ? users[uidKey] : null;
}

async function downloadBotPhoto(fileId) {
  const f = await bot.getFile(fileId);
  const ext = f.file_path.split('.').pop() || 'jpg';
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const localPath = path.join(UPLOADS_DIR, filename);
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${f.file_path}`;
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  fs.writeFileSync(localPath, Buffer.from(buf));
  return `/uploads/${filename}`;
}

bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id, userId = q.from.id, action = q.data;
  bot.answerCallbackQuery(q.id);
  const linked = getLinkedUser(userId);
  const state = botStates[userId];

  if (action === 'cb_login') { botStates[userId] = { step: 'login_email' }; bot.sendMessage(chatId, '📧 *Enter your email:*', { parse_mode: 'Markdown', reply_markup: CANCEL_KB }); return; }
  if (action === 'cb_cancel_upload') { delete botStates[userId]; bot.sendMessage(chatId, '❌ Cancelled.', { reply_markup: linked ? getMenuKB(userId) : LOGIN_KB }); return; }
  if (action === 'cb_skip' && state && state.step === 'upload_title') { state.title = 'Untitled'; state.step = 'upload_tags'; bot.sendMessage(chatId, '🏷 *Enter tags* (comma separated):', { parse_mode: 'Markdown', reply_markup: CANCEL_KB }); return; }
  if (action.startsWith('sw_') && state && state.step === 'upload_software') { state.software = action.substring(3); state.step = 'upload_prompt'; bot.sendMessage(chatId, `✅ Software: *${state.software}*\n\n📝 *Enter your prompt:*`, { parse_mode: 'Markdown', reply_markup: CANCEL_KB }); return; }

  if (action === 'cb_publish' && state && state.step === 'upload_preview') {
    const newPost = {
      id: Date.now().toString(36),
      function: state.title,
      prompt: state.prompt,
      tags: state.tags || [],
      author: linked.name,
      author_id: userId,
      before_image: state.beforeImage,
      after_image: state.afterImage,
      image: state.afterImage,
      software: state.software,
      pinned: false,
      date: new Date().toISOString()
    };
    const { error } = await supabase.from('prompts').insert(newPost);
    if (error) { bot.sendMessage(chatId, '❌ Error publishing: ' + error.message); return; }
    delete botStates[userId];
    bot.sendMessage(chatId, '✅ *Published!*', { parse_mode: 'Markdown', reply_markup: getMenuKB(userId) });
    return;
  }
  if (action === 'cb_discard') { delete botStates[userId]; bot.sendMessage(chatId, '🗑 Discarded.', { reply_markup: getMenuKB(userId) }); return; }

  if (!linked) { bot.sendMessage(chatId, '🔐 *Sign in first.*', { parse_mode: 'Markdown', reply_markup: LOGIN_KB }); return; }

  if (action === 'cb_menu') { delete botStates[userId]; bot.sendMessage(chatId, `🚀 *Welcome, ${linked.name}!*\n\n👇 *Menu:*`, { parse_mode: 'Markdown', reply_markup: getMenuKB(userId) }); return; }
  if (action === 'cb_post') { botStates[userId] = { step: 'upload_before' }; bot.sendMessage(chatId, '📸 *Step 1/6 — Before Image*\n\nSend the before photo.', { parse_mode: 'Markdown', reply_markup: CANCEL_KB }); return; }
  if (action === 'cb_list') {
    const { data: my, error } = await supabase.from('prompts').select('*').eq('author_id', userId).order('date', { ascending: false });
    if (error) { bot.sendMessage(chatId, '❌ Error loading library.'); return; }
    if (!my.length) { bot.sendMessage(chatId, '📭 Empty.', { reply_markup: { inline_keyboard: [[{ text: '✨ Create', callback_data: 'cb_post' }], [{ text: '← Menu', callback_data: 'cb_menu' }]] } }); return; }
    let t = `📚 *Library* (${my.length})\n\n`;
    const kb = { inline_keyboard: [] };
    my.forEach(p => { t += `• *${p.function}*\n`; kb.inline_keyboard.push([{ text: p.function, callback_data: `cb_view_${p.id}` }]); });
    kb.inline_keyboard.push([{ text: '← Menu', callback_data: 'cb_menu' }]);
    bot.sendMessage(chatId, t, { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  if (action === 'cb_delete_list') {
    const { data: my, error } = await supabase.from('prompts').select('*').eq('author_id', userId);
    if (error || !my.length) { bot.sendMessage(chatId, '📭 Nothing.', { reply_markup: BACK_KB }); return; }
    const kb = { inline_keyboard: my.map(p => [{ text: `🗑 ${p.function}`, callback_data: `cb_del_${p.id}` }]).concat([[{ text: '← Menu', callback_data: 'cb_menu' }]])}
    bot.sendMessage(chatId, '🗑 *Select to delete:*', { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  if (action.startsWith('cb_del_')) {
    const id = action.substring(7);
    const { error } = await supabase.from('prompts').delete().eq('id', id).or(`author_id.eq.${userId},author_id.eq.${ADMIN_ID}`); // simplified check
    if (error) { bot.sendMessage(chatId, '❌ Error deleting.'); } else { bot.sendMessage(chatId, '🗑 Deleted.', { reply_markup: BACK_KB }); }
    return;
  }
  if (action === 'cb_profile') { bot.sendMessage(chatId, `⚙️ *Profile*\n\nName: *${linked.name}*\nEmail: \`${linked.email}\``, { parse_mode: 'Markdown', reply_markup: BACK_KB }); return; }
  if (action === 'cb_help') { bot.sendMessage(chatId, '📖 Use ✨ New Prompt for step-by-step upload.', { reply_markup: BACK_KB }); return; }

  // Admin
  if (action === 'cb_admin_banners' && userId === ADMIN_ID) {
    const b = readJSON(BANNERS_FILE) || [];
    let t = `🖼 *Banners* (${b.length}/4)\n\n`;
    if (!b.length) t += 'No banners active.';
    const kb = { inline_keyboard: b.map((x, i) => [{ text: `🗑 ${x.title}`, callback_data: `cb_delbanner_${i}` }]) };
    if (b.length < 4) kb.inline_keyboard.push([{ text: '➕ Add Banner', callback_data: 'cb_add_banner' }]);
    kb.inline_keyboard.push([{ text: '← Menu', callback_data: 'cb_menu' }]);
    bot.sendMessage(chatId, t, { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  if (action === 'cb_add_banner' && userId === ADMIN_ID) {
    botStates[userId] = { step: 'banner_title' };
    bot.sendMessage(chatId, '🖼 *Step 1/2 — Banner Title*\n\nWhat should the banner text say?', { parse_mode: 'Markdown', reply_markup: CANCEL_KB });
    return;
  }
  if (action.startsWith('cb_delbanner_') && userId === ADMIN_ID) {
    const i = parseInt(action.substring(13));
    const b = readJSON(BANNERS_FILE) || [];
    if (b[i]) { b.splice(i, 1); writeJSON(BANNERS_FILE, b); bot.sendMessage(chatId, '🗑 Deleted.', { reply_markup: BACK_KB }); }
    return;
  }
  if (action === 'cb_admin_pin' && userId === ADMIN_ID) {
    const kb = { inline_keyboard: [
      [{ text: '📌 Pin New Prompt', callback_data: 'cb_admin_pin_list' }],
      [{ text: '🗑 Unpin Prompt', callback_data: 'cb_admin_unpin_list' }],
      [{ text: '← Menu', callback_data: 'cb_menu' }]
    ]};
    bot.sendMessage(chatId, '📋 *Pin Management*', { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  if (action === 'cb_admin_pin_list' && userId === ADMIN_ID) {
    const { data: unpinned, error } = await supabase.from('prompts').select('*').eq('pinned', false).limit(15);
    if (error || !unpinned.length) { bot.sendMessage(chatId, '📭 No unpinned posts available.', { reply_markup: BACK_KB }); return; }
    const kb = { inline_keyboard: unpinned.map(p => [{ text: '📌 ' + p.function, callback_data: `cb_togglepin_${p.id}` }]).concat([[{ text: '← Back', callback_data: 'cb_admin_pin' }]]) };
    bot.sendMessage(chatId, '📌 *Select to Pin:*', { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  if (action === 'cb_admin_unpin_list' && userId === ADMIN_ID) {
    const { data: pinned, error } = await supabase.from('prompts').select('*').eq('pinned', true);
    if (error || !pinned.length) { bot.sendMessage(chatId, '📭 No pinned posts.', { reply_markup: BACK_KB }); return; }
    const kb = { inline_keyboard: pinned.map(p => [{ text: '🗑 ' + p.function, callback_data: `cb_togglepin_${p.id}` }]).concat([[{ text: '← Back', callback_data: 'cb_admin_pin' }]]) };
    bot.sendMessage(chatId, '🗑 *Select to Unpin:*', { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  if (action.startsWith('cb_togglepin_') && userId === ADMIN_ID) {
    const id = action.substring(13);
    const { data: p } = await supabase.from('prompts').select('pinned, function').eq('id', id).single();
    if (p) {
      const { error } = await supabase.from('prompts').update({ pinned: !p.pinned }).eq('id', id);
      if (!error) bot.sendMessage(chatId, `${!p.pinned ? '📌 Pinned' : 'Unpinned'}: *${p.function}*`, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '← Back', callback_data: 'cb_admin_pin' }]] } });
    }
    return;
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id, userId = msg.from.id, text = (msg.text || '').trim();
  const linked = getLinkedUser(userId);
  const state = botStates[userId];

  // Login flow
  if (state && state.step === 'login_email') {
    if (!text.includes('@')) { bot.sendMessage(chatId, '❌ Enter a valid email.', { reply_markup: CANCEL_KB }); return; }
    state.loginEmail = text.toLowerCase(); state.step = 'login_password';
    bot.sendMessage(chatId, '🔑 *Enter password:*', { parse_mode: 'Markdown', reply_markup: CANCEL_KB });
    return;
  }
  if (state && state.step === 'login_password') {
    const users = readJSON(USERS_FILE);
    const uidKey = users['email_' + state.loginEmail];
    if (!uidKey || !users[uidKey]) { delete botStates[userId]; bot.sendMessage(chatId, '❌ Account not found. Sign up on website.', { reply_markup: LOGIN_KB }); return; }
    const u = users[uidKey];
    if (u.password !== hashPassword(text)) { delete botStates[userId]; bot.sendMessage(chatId, '❌ Wrong password.', { reply_markup: LOGIN_KB }); return; }
    u.telegramLinked = true; u.telegramId = userId;
    users['tg_' + userId] = uidKey;
    writeJSON(USERS_FILE, users);
    delete botStates[userId];
    bot.sendMessage(chatId, `✅ *Signed in as ${u.name}!*\n\n👇 *Menu:*`, { parse_mode: 'Markdown', reply_markup: getMenuKB(userId) });
    return;
  }

  // Upload steps
  if (state && linked) {
    if (state.step === 'upload_before') {
      if (!msg.photo) { bot.sendMessage(chatId, '📸 Send a photo.', { reply_markup: CANCEL_KB }); return; }
      state.beforeImage = await downloadBotPhoto(msg.photo[msg.photo.length - 1].file_id);
      state.step = 'upload_after';
      bot.sendMessage(chatId, '✅ Before saved!\n\n📸 *Step 2/6 — After Image*', { parse_mode: 'Markdown', reply_markup: CANCEL_KB });
      return;
    }
    if (state.step === 'upload_after') {
      if (!msg.photo) { bot.sendMessage(chatId, '📸 Send a photo.', { reply_markup: CANCEL_KB }); return; }
      state.afterImage = await downloadBotPhoto(msg.photo[msg.photo.length - 1].file_id);
      state.step = 'upload_title';
      bot.sendMessage(chatId, '✅ After saved!\n\n✏️ *Step 3/6 — Title* (or skip)', { parse_mode: 'Markdown', reply_markup: SKIP_KB });
      return;
    }
    if (state.step === 'upload_title') {
      state.title = text || 'Untitled'; state.step = 'upload_tags';
      bot.sendMessage(chatId, `✅ Title: *${state.title}*\n\n🏷 *Step 4/6 — Tags*\nComma separated.`, { parse_mode: 'Markdown', reply_markup: CANCEL_KB });
      return;
    }
    if (state.step === 'upload_tags') {
      state.tags = text.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      state.step = 'upload_software';
      bot.sendMessage(chatId, '✅ Tags saved!\n\n🖥 *Step 5/6 — Software*', { parse_mode: 'Markdown', reply_markup: SOFTWARE_KB });
      return;
    }
    if (state.step === 'upload_prompt') {
      if (!text) { bot.sendMessage(chatId, '📝 Enter prompt text.', { reply_markup: CANCEL_KB }); return; }
      state.prompt = text; state.step = 'upload_preview';
      bot.sendMessage(chatId, `👀 *Preview*\n━━━━━━━━━━━━━━━\n📌 *${state.title}*\n🏷 ${(state.tags || []).join(', ')}\n🖥 ${state.software}\n📝 ${state.prompt.substring(0, 150)}...\n\n*Publish?*`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '✅ Publish', callback_data: 'cb_publish' }, { text: '🗑 Discard', callback_data: 'cb_discard' }]] }
      });
      return;
    }
  }

  // Banner upload flow (Admin)
  if (state && userId === ADMIN_ID) {
    if (state.step === 'banner_title') {
      state.bannerTitle = text || 'New Feature';
      state.step = 'banner_photo';
      bot.sendMessage(chatId, `✅ Title: *${state.bannerTitle}*\n\n📸 *Step 2/2 — Photo*\nSend the banner image.`, { parse_mode: 'Markdown', reply_markup: CANCEL_KB });
      return;
    }
    if (state.step === 'banner_photo') {
      if (!msg.photo) { bot.sendMessage(chatId, '📸 Send a photo.', { reply_markup: CANCEL_KB }); return; }
      const imgUrl = await downloadBotPhoto(msg.photo[msg.photo.length - 1].file_id);
      const banners = readJSON(BANNERS_FILE) || [];
      banners.push({ image: imgUrl, title: state.bannerTitle, tag: 'NEW', date: new Date().toISOString() });
      writeJSON(BANNERS_FILE, banners);
      delete botStates[userId];
      bot.sendMessage(chatId, `✅ *Banner Added: "${state.bannerTitle}"*`, { parse_mode: 'Markdown', reply_markup: BACK_KB });
      return;
    }
  }

  if (!linked) {
    if (text === '/start') { bot.sendMessage(chatId, '🎨 *Welcome to Promptefy Bot*\n\n🔐 Sign in to get started:', { parse_mode: 'Markdown', reply_markup: LOGIN_KB }); return; }
    bot.sendMessage(chatId, '🔐 Sign in first.', { reply_markup: LOGIN_KB });
    return;
  }

  if (text === '/start') { delete botStates[userId]; bot.sendMessage(chatId, `🚀 *Welcome, ${linked.name}!*\n\n👇 *Menu:*`, { parse_mode: 'Markdown', reply_markup: getMenuKB(userId) }); return; }

  // Persistent Menu Keyboard Handlers
  if (text === '✨ New Prompt') {
    botStates[userId] = { step: 'upload_before' };
    bot.sendMessage(chatId, '📸 *Step 1/6 — Before Image*\n━━━━━━━━━━━━━━━━━━━━\n\nSend the *before* image (the input/reference).', { parse_mode: 'Markdown', reply_markup: CANCEL_KB });
    return;
  }
  if (text === '📚 My Library') {
    supabase.from('prompts').select('*').eq('author_id', userId).order('date', { ascending: false }).then(({ data: my }) => {
      if (!my || my.length === 0) { bot.sendMessage(chatId, '📭 Your library is empty.', { parse_mode: 'Markdown', reply_markup: BACK_KB }); return; }
      let t = `📚 *Your Library* (${my.length})\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      const bk = { inline_keyboard: [] };
      my.forEach((p, i) => { t += `${i + 1}. ${p.pinned ? '📌 ' : ''}*${p.function}*\n`; bk.inline_keyboard.push([{ text: `📝 ${p.function}`, callback_data: `cb_view_${p.id}` }]); });
      bot.sendMessage(chatId, t, { parse_mode: 'Markdown', reply_markup: bk });
    });
    return;
  }
  if (text === '🗑 Delete') {
    supabase.from('prompts').select('*').eq('author_id', userId).then(({ data: my }) => {
      if (!my || my.length === 0) { bot.sendMessage(chatId, '📭 Nothing to delete.'); return; }
      const bk = { inline_keyboard: [] };
      my.forEach(p => bk.inline_keyboard.push([{ text: `🗑 ${p.function}`, callback_data: `cb_del_${p.id}` }]));
      bot.sendMessage(chatId, '🗑 *Select to Delete*', { parse_mode: 'Markdown', reply_markup: bk });
    });
    return;
  }
  if (text === '⚙️ Profile') {
    bot.sendMessage(chatId, `👤 *Profile*\nName: ${linked.name}\nEmail: ${linked.email}\nJoined: ${new Date(linked.joined).toLocaleDateString()}`, { parse_mode: 'Markdown' });
    return;
  }
  if (text === '🏷 Help') {
    bot.sendMessage(chatId, `🏷 *Help*\nUpload before/after photos of your AI generations and share the prompts that created them!`, { parse_mode: 'Markdown' });
    return;
  }
  if (text === '🖼 Banners' && userId === ADMIN_ID) {
    const banners = readJSON(BANNERS_FILE) || [];
    if (banners.length === 0) {
      botStates[userId] = { step: 'banner_title' };
      bot.sendMessage(chatId, '📭 No banners. Let\'s add one.\n\n✏️ *Step 1/2 — Title*', { parse_mode: 'Markdown', reply_markup: CANCEL_KB });
      return;
    }
    const kb = { inline_keyboard: [] };
    banners.forEach((x, i) => kb.inline_keyboard.push([{ text: `🗑 ${x.title}`, callback_data: `cb_delbanner_${i}` }]));
    kb.inline_keyboard.push([{ text: '➕ Add Banner', callback_data: 'cb_addbanner' }]);
    bot.sendMessage(chatId, '🖼 *Manage Banners*', { parse_mode: 'Markdown', reply_markup: kb });
    return;
  }
  if (text === '📌 Pin' && userId === ADMIN_ID) {
    supabase.from('prompts').select('*').order('date', { ascending: false }).limit(20).then(({ data: posts }) => {
      if (!posts) return;
      const bk = { inline_keyboard: [] };
      posts.forEach((p) => bk.inline_keyboard.push([{ text: `${p.pinned ? '📌' : '📍'} ${p.function}`, callback_data: `cb_pin_${p.id}` }]));
      bot.sendMessage(chatId, '📌 *Select a prompt to pin/unpin*', { parse_mode: 'Markdown', reply_markup: bk });
    });
    return;
  }

  // Admin banner
  if (msg.photo && userId === ADMIN_ID && !state) {
    const caption = (msg.caption || '').trim();
    if (caption.toLowerCase().startsWith('banner:')) {
      const title = caption.substring(7).trim();
      const banners = readJSON(BANNERS_FILE) || [];
      if (banners.length >= 4) { bot.sendMessage(chatId, '❌ Max 4.'); return; }
      const imgUrl = await downloadBotPhoto(msg.photo[msg.photo.length - 1].file_id);
      banners.push({ image: imgUrl, title, tag: 'New', date: new Date().toISOString() });
      writeJSON(BANNERS_FILE, banners);
      bot.sendMessage(chatId, `✅ Banner: "${title}"`, { reply_markup: BACK_KB });
      return;
    }
  }

  if (text.startsWith('/pin ') && userId === ADMIN_ID) {
    const id = text.split(' ')[1];
    supabase.from('prompts').update({ pinned: true }).eq('id', id).then(({ error }) => {
      if (!error) bot.sendMessage(chatId, `📌 Pinned: *${id}*`, { parse_mode: 'Markdown' });
    });
    return;
  }
  if (text.startsWith('/unpin ') && userId === ADMIN_ID) {
    const id = text.split(' ')[1];
    supabase.from('prompts').update({ pinned: false }).eq('id', id).then(({ error }) => {
      if (!error) bot.sendMessage(chatId, `Unpinned: *${id}*`, { parse_mode: 'Markdown' });
    });
    return;
  }
});

console.log('🤖 Bot active.');
