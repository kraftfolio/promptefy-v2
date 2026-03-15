# Promptefy V2 🚀

**Promptefy** is a community-powered AI prompt library designed for the next generation of generative AI models including Sora, Runway Gen-3, Flux, Midjourney, and more. It features a seamless ecosystem where users can discover, share, and manage high-quality AI prompts through both a modern web interface and a powerful Telegram bot.

![Promptefy Banner](https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?q=80&w=2564&auto=format&fit=crop)

## ✨ Core Features

- **Supabase Integration**: Unified authentication and real-time database management using Supabase.
- **Telegram Bot v2**: A robust bot for publishing prompts, managing libraries, and admin curation.
- **Live Activity Counters**: Real-time fluctuating online status and prompt library metrics.
- **Glassmorphism UI**: A premium, monochrome wireframe aesthetic with smooth micro-animations.
- **Video Prompt Library**: Specialized categories for Sora, Runway, and other video-generation models.
- **User Ecosystem**: Personalized profiles with "Saved" and "Liked" prompts.
- **Image Comparison**: Side-by-side reference and output sliders for prompt validation.

## 🛠 Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), Modern CSS (Backdrop Blur, CSS Variables), Semantic HTML5.
- **Backend**: Node.js, Express.
- **Database & Auth**: [Supabase](https://supabase.com/) (PostgreSQL + Auth).
- **Serverless**: Netlify Functions for production-grade webhooks and API endpoints.
- **Bot API**: `node-telegram-bot-api`.

## 🚀 Getting Started

### Prerequisites

- Node.js (v18+)
- A Supabase Project
- A Telegram Bot Token from @BotFather

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/kraftfolio/promptefy-v2.git
   cd promptefy-v2
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Environment Setup**:
   Create a `.env` file in the root directory and add your credentials:
   ```env
   BOT_TOKEN=your_telegram_bot_token
   ADMIN_ID=your_telegram_id
   SUPABASE_URL=your_supabase_project_url
   SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   ```

4. **Database Setup**:
   Run the SQL provided in `supabase_prompts.sql` and `supabase_schema.sql` within your Supabase SQL Editor to create the necessary tables and RLS policies.

5. **Run Locally**:
   ```bash
   npm start
   ```

## 📂 Project Structure

- `/public`: Static web assets (HTML, CSS, JS).
- `/netlify/functions`: Serverless API endpoints & Telegram Webhook.
- `server.js`: Local Express development server.
- `migrate_prompts.mjs`: Script for data migration from JSON to Supabase.
- `supabase_prompts.sql`: Prompt table schema.

## 🤖 Telegram Bot Commands

- `/start`: Initialize interaction and linking.
- `Publish`: Interactive flow to upload a new prompt with images.
- `My Library`: View and manage your personal prompt collection.
- `📌 Pin` (Admin): Feature high-quality prompts on the trending section.

## 📄 License

This project is open-source and available under the MIT License.

---
Built with ❤️ by [kraftfolio](https://github.com/kraftfolio)
