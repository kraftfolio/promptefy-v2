import fs from 'fs';
import path from 'path';

const localPath = path.join(process.cwd(), 'posts.json');
const netlifyPath = path.join(process.cwd(), 'netlify_posts.json');

const localPosts = JSON.parse(fs.readFileSync(localPath, 'utf8'));
const netlifyPosts = JSON.parse(fs.readFileSync(netlifyPath, 'utf8'));

console.log(`📦 Local: ${localPosts.length}`);
console.log(`📦 Netlify: ${netlifyPosts.length}`);

const allPostsMap = new Map();

// Load netlify posts first (usually more recent)
netlifyPosts.forEach(p => allPostsMap.set(p.id, p));
// Load local posts (overwrite if IDs match, or keep netlify as source of truth if preferred)
localPosts.forEach(p => {
    if (!allPostsMap.has(p.id)) {
        allPostsMap.set(p.id, p);
    }
});

const mergedPosts = Array.from(allPostsMap.values());
console.log(`✅ Total Merged: ${mergedPosts.length}`);

fs.writeFileSync(path.join(process.cwd(), 'merged_posts.json'), JSON.stringify(mergedPosts, null, 2));
console.log("💾 Saved to merged_posts.json");
