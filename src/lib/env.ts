export interface AppEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export function readAppEnv(): AppEnv {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.');
  }

  return { supabaseUrl, supabasePublishableKey };
}
