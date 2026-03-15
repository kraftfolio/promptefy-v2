import { getStore } from "@netlify/blobs";

export default async (req) => {
    // CORS preflight
    if (req.method === "OPTIONS") {
        return new Response("OK", {
            headers: {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
        });
    }

    const headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
    };

    const store = getStore("comments");

    // GET — fetch comments for a post
    if (req.method === "GET") {
        const url = new URL(req.url);
        const postId = url.searchParams.get("post");
        if (!postId) return new Response(JSON.stringify({ error: "Missing post" }), { status: 400, headers });

        try {
            const raw = await store.get(`c_${postId}`);
            const comments = raw ? JSON.parse(raw) : [];
            return new Response(JSON.stringify(comments), { headers });
        } catch {
            return new Response(JSON.stringify([]), { headers });
        }
    }

    // POST — add a comment
    if (req.method === "POST") {
        try {
            const { postId, uid, name, picture, text } = await req.json();
            if (!postId || !uid || !text) {
                return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers });
            }

            const key = `c_${postId}`;
            let comments = [];
            try {
                const raw = await store.get(key);
                comments = raw ? JSON.parse(raw) : [];
            } catch { comments = []; }

            comments.push({
                id: Date.now().toString(36),
                uid,
                name: name || "Anonymous",
                picture: picture || null,
                text: text.substring(0, 500), // limit length
                date: new Date().toISOString(),
            });

            // Keep latest 100 comments per post
            if (comments.length > 100) comments = comments.slice(-100);

            await store.set(key, JSON.stringify(comments));

            return new Response(JSON.stringify({ ok: true, comments }), { headers });
        } catch (err) {
            console.error("Comments error:", err);
            return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers });
        }
    }

    return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/comments" };
