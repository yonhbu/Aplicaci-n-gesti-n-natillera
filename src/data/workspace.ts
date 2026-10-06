import { supabase } from '../lib/supabase';
import type { Cycle, Workspace, WorkspaceContext } from '../lib/types';

export async function fetchWorkspaceContext(): Promise<WorkspaceContext> {
  const workspaceResult = await supabase.from('workspaces').select('*').limit(2);
  if (workspaceResult.error) {
    throw new Error(workspaceResult.error.message);
  }

  const workspace = (workspaceResult.data?.[0] as Workspace | undefined) ?? null;
  if (!workspace) {
    return { workspace: null, activeCycle: null };
  }

  const cycleResult = await supabase
    .from('cycles')
    .select('*')
    .eq('workspace_id', workspace.id)
    .eq('status', 'active')
    .order('year', { ascending: false })
    .limit(1);

  if (cycleResult.error) {
    throw new Error(cycleResult.error.message);
  }

  return {
    workspace,
    activeCycle: (cycleResult.data?.[0] as Cycle | undefined) ?? null
  };
}
