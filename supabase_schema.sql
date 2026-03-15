-- 1. Create a table for public profiles extending the auth.users table
CREATE TABLE public.profiles (
  id uuid references auth.users(id) on delete cascade not null primary key,
  email text not null,
  name text,
  saved text[] default '{}'::text[],
  likes text[] default '{}'::text[],
  telegram_linked boolean default false,
  telegram_id bigint unique,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Turn on Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 3. Create policies so users can read/update only their own profile
CREATE POLICY "Users can view their own profile." 
  ON public.profiles FOR SELECT 
  USING ( auth.uid() = id );

CREATE POLICY "Users can update their own profile." 
  ON public.profiles FOR UPDATE 
  USING ( auth.uid() = id );

CREATE POLICY "Service role can manage all profiles." 
  ON public.profiles FOR ALL 
  USING ( auth.jwt() ->> 'role' = 'service_role' );

-- 4. Create a function to automatically create a profile for new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name' -- Handles Google OAuth names & custom signups
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Set up the trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
