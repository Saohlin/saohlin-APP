/**
 * Claudia's testing marks (C6): four marks and an optional note on a finished
 * CLAUDIA AI answer. Only tester accounts can save them; the server refuses
 * everyone else (`NOT_TESTER`), and row rules keep each tester to their own
 * answers. The admin panel reads them back as a worklist.
 */
import { supabase } from '../supabase';

export const MARKS = ['right', 'too_generic', 'should_have_asked', 'wrong_guide'] as const;
export type Mark = (typeof MARKS)[number];

/** The server's ceiling for a note. */
export const MAX_NOTE_CHARS = 2000;

export type AnswerMarks = { marks: Mark[]; note: string | null };

/** The tester's marks on these answers, keyed by message id. Answers without marks are absent. */
export async function listMarks(messageIds: string[]): Promise<Record<string, AnswerMarks>> {
  if (messageIds.length === 0) return {};
  const { data, error } = await supabase
    .from('answer_marks')
    .select('message_id, mark, note')
    .in('message_id', messageIds);
  if (error) throw error;
  const out: Record<string, AnswerMarks> = {};
  for (const row of (data ?? []) as { message_id: string; mark: Mark; note: string | null }[]) {
    const entry = (out[row.message_id] ??= { marks: [], note: null });
    entry.marks.push(row.mark);
    entry.note = entry.note ?? row.note;
  }
  return out;
}

export async function addMark(userId: string, messageId: string, mark: Mark, note: string | null): Promise<void> {
  const { error } = await supabase.from('answer_marks').insert({ message_id: messageId, user_id: userId, mark, note });
  // A double tap that arrives twice is already saved.
  if (error && error.code !== '23505') throw error;
}

export async function removeMark(userId: string, messageId: string, mark: Mark): Promise<void> {
  const { error } = await supabase
    .from('answer_marks')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('mark', mark);
  if (error) throw error;
}

/** One note per answer: it is kept on every mark of that answer. */
export async function saveNote(userId: string, messageId: string, note: string | null): Promise<void> {
  const { error } = await supabase
    .from('answer_marks')
    .update({ note, updated_at: new Date().toISOString() })
    .eq('message_id', messageId)
    .eq('user_id', userId);
  if (error) throw error;
}
