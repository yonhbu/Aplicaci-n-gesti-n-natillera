import { supabase } from '../lib/supabase';

/** One database statement supplies all current workspace data, independently of UI cache or pagination. */
export async function exportNatilleraBackup(workspaceId: string) {
  const { data, error } = await supabase.rpc('export_natillera_backup', { p_workspace_id: workspaceId });
  if (error) throw new Error(error.message);
  return data;
}
