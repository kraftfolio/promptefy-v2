import { getStore } from "@netlify/blobs";

export default async (req) => {
    const url = new URL(req.url);
    const filename = url.pathname.split("/").pop();

    if (!filename) {
        return new Response("Not found", { status: 404 });
    }

    const store = getStore("images");
    const data = await store.get(filename, { type: "arrayBuffer" });

    if (!data) {
        return new Response("Not found", { status: 404 });
    }

    const ext = filename.split(".").pop().toLowerCase();
    const types = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp" };
    const contentType = types[ext] || "application/octet-stream";

    return new Response(data, {
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
};

export const config = {
    path: "/api/image/:filename",
};
