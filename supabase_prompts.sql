-- Existing posts table (to match posts.json)
CREATE TABLE public.prompts (
  id text primary key, -- Using the existing short IDs for consistency
  function text, -- Title
  prompt text,
  tags text[] default '{}'::text[],
  author text,
  author_id bigint, -- Telegram ID
  image text,
  before_image text,
  after_image text,
  software text,
  pinned boolean default false,
  date timestamp with time zone default now(),
  user_id uuid references auth.users(id) on delete set null -- Link to Supabase Auth
);

-- Turn on Row Level Security
ALTER TABLE public.prompts ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Prompts are viewable by everyone." 
  ON public.prompts FOR SELECT 
  USING ( true );

CREATE POLICY "Logged in users can create prompts." 
  ON public.prompts FOR INSERT 
  WITH CHECK ( auth.role() = 'authenticated' );

CREATE POLICY "Users can update their own prompts." 
  ON public.prompts FOR UPDATE 
  USING ( auth.uid() = user_id );

CREATE POLICY "Users can delete their own prompts." 
  ON public.prompts FOR DELETE 
  USING ( auth.uid() = user_id );

CREATE POLICY "Admin can manage all prompts." 
  ON public.prompts FOR ALL 
  USING ( auth.jwt() ->> 'role' = 'service_role' );
