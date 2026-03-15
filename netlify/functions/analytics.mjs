import { getStore } from "@netlify/blobs";

export default async (req) => {
    try {
        // Only accept POST
        if (req.method !== "POST") {
            return new Response("OK", { status: 200 });
        }

        const body = await req.json();
        const { action, label } = body;

        if (!action || !label) {
            return new Response("Missing fields", { status: 400 });
        }

        const store = getStore("analytics");

        // Increment counter for this action+label combination
        const key = `${action}_${label.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50)}`;
        let count = 0;
        try {
            const raw = await store.get(key);
            count = raw ? parseInt(raw, 10) : 0;
        } catch { count = 0; }

        await store.set(key, String(count + 1));

        // Also track global totals
        const totalKey = `total_${action}`;
        let totalCount = 0;
        try {
            const rawTotal = await store.get(totalKey);
            totalCount = rawTotal ? parseInt(rawTotal, 10) : 0;
        } catch { totalCount = 0; }

        await store.set(totalKey, String(totalCount + 1));

        return new Response(JSON.stringify({ ok: true }), {
            headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
            },
        });
    } catch (err) {
        console.error("Analytics error:", err);
        return new Response("Error", { status: 500 });
    }
};

export const config = {
    path: "/api/analytics",
};
