export default async function handler(req, context) {
    return new Response(JSON.stringify({
        SUPABASE_URL: process.env.SUPABASE_URL || "",
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || ""
    }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
}
