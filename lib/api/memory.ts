import { supabase } from '../supabase';

/** A fact CLAUDIA AI keeps about the user (memory layer 3). */
export type MemoryNote = { id: string; category: string; key: string; content: string; updatedAt: string };
/** A past conversation and its summary (memory layer 2). */
export type MemoryConversation = { id: string; title: string | null; summary: string; updatedAt: string };
export type Memory = { notes: MemoryNote[]; conversations: MemoryConversation[]; momentsCount: number };

/** What CLAUDIA AI remembers from conversations. The profile and answers come from the session. */
export async function getMemory(): Promise<Memory> {
  const { data, error } = await supabase.rpc('get_memory');
  if (error) throw error;
  const m = (data ?? {}) as Partial<Memory>;
  return { notes: m.notes ?? [], conversations: m.conversations ?? [], momentsCount: m.momentsCount ?? 0 };
}

export async function forgetNote(id: string) {
  const { error } = await supabase.rpc('forget_note', { p_id: id });
  if (error) throw error;
}

/** Deletes notes, summaries and moments and hides past conversations. The profile stays. */
export async function clearMemory() {
  const { error } = await supabase.rpc('clear_memory');
  if (error) throw error;
}
