import { getStore } from "@netlify/blobs";

export default async (req) => {
    const store = getStore("data");
    let banners = [];
    try {
        const raw = await store.get("banners");
        banners = raw ? JSON.parse(raw) : [];
    } catch { banners = []; }

    return new Response(JSON.stringify(banners), {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
    });
};

export const config = { path: "/api/banners" };
