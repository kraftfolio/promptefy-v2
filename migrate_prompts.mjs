import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

async function migrate() {
    console.log("🚀 Starting migration of merged prompts...");
    
    const postsPath = path.join(process.cwd(), 'merged_posts.json');
    if (!fs.existsSync(postsPath)) {
        console.error("❌ merged_posts.json not found! Run merge_data.mjs first.");
        return;
    }

    const posts = JSON.parse(fs.readFileSync(postsPath, 'utf8'));
    console.log(`📦 Found ${posts.length} unique posts to migrate.`);

    for (const post of posts) {
        console.log(`➡️ Migrating: ${post.function || post.id}`);
        
        const { error } = await supabase
            .from('prompts')
            .upsert({
                id: post.id,
                function: post.function,
                prompt: post.prompt,
                tags: post.tags || [],
                author: post.author,
                author_id: post.author_id,
                image: post.image,
                before_image: post.beforeImage || post.image, // fallback
                after_image: post.afterImage,
                software: post.software,
                pinned: !!post.pinned,
                date: post.date || new Date().toISOString()
            });

        if (error) {
            console.error(`❌ Error migrating ${post.id}:`, error.message);
        }
    }

    console.log("✅ Migration complete!");
}

migrate();
