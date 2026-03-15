import { getStore } from "@netlify/blobs";

export default async (req) => {
    const store = getStore("data");
    const posts = await store.get("posts", { type: "json" }) || [];

    // Enrich posts with like counts
    for (const post of posts) {
        try {
            const raw = await store.get(`likes_${post.id}`);
            post.likes = raw ? parseInt(raw, 10) : 0;
        } catch { post.likes = 0; }
    }

    return new Response(JSON.stringify(posts), {
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        },
    });
};

export const config = {
    path: "/api/posts",
};
