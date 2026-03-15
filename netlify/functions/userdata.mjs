import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";
const supabase = createClient(supabaseUrl, supabaseKey);

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

    // GET — retrieve user profile data from Supabase
    if (req.method === "GET") {
        const url = new URL(req.url);
        const uid = url.searchParams.get("uid");
        if (!uid) return new Response(JSON.stringify({ error: "Missing uid" }), { status: 400, headers });

        try {
            const { data: profile, error } = await supabase.from("profiles").select("*").eq("id", uid).single();
            if (error || !profile) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers });
            return new Response(JSON.stringify(profile), { headers });
        } catch {
            return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers });
        }
    }

    // POST — save/unsave, like/unlike
    if (req.method === "POST") {
        try {
            const { uid, action, postId } = await req.json();
            if (!uid || !action || !postId) {
                return new Response(JSON.stringify({ error: "Missing fields" }), { status: 400, headers });
            }

            // 1. Get current profile
            const { data: profile, error: getError } = await supabase.from("profiles").select("*").eq("id", uid).single();
            if (getError || !profile) return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers });

            let updatedSaved = profile.saved || [];
            let updatedLikes = profile.likes || [];

            if (action === "save") {
                if (!updatedSaved.includes(postId)) updatedSaved.push(postId);
            } else if (action === "unsave") {
                updatedSaved = updatedSaved.filter(id => id !== postId);
            } else if (action === "like") {
                if (!updatedLikes.includes(postId)) updatedLikes.push(postId);
            } else if (action === "unlike") {
                updatedLikes = updatedLikes.filter(id => id !== postId);
            }

            // 2. Update profile in Supabase
            const { data: updatedProfile, error: updateError } = await supabase
                .from("profiles")
                .update({ saved: updatedSaved, likes: updatedLikes })
                .eq("id", uid)
                .select()
                .single();

            if (updateError) throw updateError;

            // 3. Update global like count in prompts table (optional, but good for performance)
            // We can calculate this live, but if you want a counter:
            let likeChange = 0;
            if (action === "like") likeChange = 1;
            else if (action === "unlike") likeChange = -1;

            if (likeChange !== 0) {
                // Get current like count first (or use rpc if you have a counter function)
                const { data: prompt } = await supabase.from("prompts").select("likes").eq("id", postId).single();
                const newCount = (prompt?.likes || 0) + likeChange;
                await supabase.from("prompts").update({ likes: newCount }).eq("id", postId);
            }

            return new Response(JSON.stringify({ ok: true, user: updatedProfile }), { headers });
        } catch (err) {
            console.error("Userdata error:", err);
            return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers });
        }
    }

    return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/userdata" };
