import { getStore } from "@netlify/blobs";
import { google } from "googleapis";

// ── Google Sheets Helper ────────────────────────────────

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];
const SHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SVC_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PVT_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

async function syncUserToSheets(user) {
    if (!SHEET_ID || !SVC_EMAIL || !PVT_KEY) return;
    try {
        const auth = new google.auth.JWT(SVC_EMAIL, null, PVT_KEY, SCOPES);
        const sheets = google.sheets({ version: "v4", auth });
        const values = [[user.uid, user.email, user.name, user.password, user.joined, user.telegramLinked ? user.telegramId : "No"]];
        await sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: "Users!A:F",
            valueInputOption: "RAW",
            resource: { values },
        });
    } catch (e) { console.error("Sheets Error:", e.message); }
}

async function findUserInSheets(email) {
    if (!SHEET_ID || !SVC_EMAIL || !PVT_KEY) return null;
    try {
        const auth = new google.auth.JWT(SVC_EMAIL, null, PVT_KEY, SCOPES);
        const sheets = google.sheets({ version: "v4", auth });
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: "Users!A:F" });
        const rows = res.data.values;
        if (!rows) return null;
        const match = rows.reverse().find(r => r[1] === email.toLowerCase());
        if (match) {
            return { uid: match[0], email: match[1], name: match[2], password: match[3], joined: match[4], telegramLinked: match[5] !== "No", telegramId: match[5] !== "No" ? match[5] : null };
        }
    } catch (e) { console.error("Sheets Find Error:", e.message); }
    return null;
}

// Simple SHA-256 hash using Web Crypto API
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "_promptefy_salt_2026");
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateToken() {
    return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 14);
}

export default async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("OK", {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            },
        });
    }

    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

    try {
        const body = await req.json();
        const { action, email, password, name, token } = body;
        const store = getStore("users");

        // ── SYNC SESSION ─────────────────────────────
        if (action === "sync_session") {
            const { uid, email, name, token, telegramId } = body;
            if (!uid || !email || !token) return new Response(JSON.stringify({ error: "Supabase Session required" }), { status: 400, headers });

            let user = null;
            try {
                const existing = await store.get(uid);
                if (existing) {
                    user = JSON.parse(existing);
                    user.token = token; // refresh session token for verification
                }
            } catch {}

            if (!user) {
                user = {
                    uid,
                    email: email.toLowerCase(),
                    name: name || email.split('@')[0],
                    token,
                    saved: [],
                    likes: [],
                    telegramLinked: false,
                    telegramId: null,
                    joined: new Date().toISOString(),
                };
            }

            await store.set(uid, JSON.stringify(user));
            await store.set("email_" + email.toLowerCase(), uid);
            
            // Sync to Sheets
            await syncUserToSheets(user);

            const safeUser = { uid: user.uid, email: user.email, name: user.name, saved: user.saved, likes: user.likes, token };
            return new Response(JSON.stringify({ ok: true, user: safeUser }), { headers });
        }

        // ── VERIFY TOKEN ────────────────────────
        if (action === "verify") {
            if (!token || !email) return new Response(JSON.stringify({ error: "Missing" }), { status: 400, headers });

            const uidKey = await store.get("email_" + email.toLowerCase());
            if (!uidKey) return new Response(JSON.stringify({ valid: false }), { headers });

            const raw = await store.get(uidKey);
            if (!raw) return new Response(JSON.stringify({ valid: false }), { headers });

            const user = JSON.parse(raw);
            if (user.token !== token) return new Response(JSON.stringify({ valid: false }), { headers });

            const safeUser = { uid: user.uid, email: user.email, name: user.name, saved: user.saved, likes: user.likes, token };
            return new Response(JSON.stringify({ valid: true, user: safeUser }), { headers });
        }

        // ── TELEGRAM LOGIN ──────────────────────
        if (action === "telegram_login") {
            const { telegramId } = body;
            if (!email || !password || !telegramId) return new Response(JSON.stringify({ error: "All fields required" }), { status: 400, headers });

            const uidKey = await store.get("email_" + email.toLowerCase());
            if (!uidKey) return new Response(JSON.stringify({ error: "Account not found. Sign up on the website first." }), { status: 404, headers });

            const raw = await store.get(uidKey);
            const user = JSON.parse(raw);
            const hashedPw = await hashPassword(password);
            if (user.password !== hashedPw) return new Response(JSON.stringify({ error: "Wrong password" }), { status: 401, headers });

            // Link telegram
            user.telegramLinked = true;
            user.telegramId = telegramId;
            await store.set(uidKey, JSON.stringify(user));

            // Also store telegramId→uid mapping
            await store.set("tg_" + telegramId, uidKey);
            
            // Sync updated user to Sheets
            await syncUserToSheets(user);

            return new Response(JSON.stringify({ ok: true, name: user.name }), { headers });
        }

        return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
    } catch (err) {
        console.error("Auth error:", err);
        return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers });
    }
};

export const config = { path: "/api/auth" };
