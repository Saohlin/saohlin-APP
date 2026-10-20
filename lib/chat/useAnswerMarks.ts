import { useCallback, useEffect, useRef, useState } from 'react';

import { addMark, listMarks, removeMark, saveNote, type AnswerMarks, type Mark } from '../api/marks';

const NONE: AnswerMarks = { marks: [], note: null };

/**
 * Marks on the answers on screen, for tester accounts only. Changes show at
 * once and are rolled back if the server refuses them; `onError` lets the
 * screen say so.
 */
export function useAnswerMarks({
  enabled,
  userId,
  answerIds,
  onError,
}: {
  enabled: boolean;
  userId: string | undefined;
  answerIds: string[];
  onError: () => void;
}) {
  const [byId, setById] = useState<Record<string, AnswerMarks>>({});
  const loaded = useRef(new Set<string>());
  const loadedFor = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const key = answerIds.join(',');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !userId) return;
    // A different account on this phone starts from nothing.
    if (loadedFor.current !== userId) {
      loadedFor.current = userId;
      loaded.current.clear();
      setById({});
    }
    const missing = answerIds.filter((id) => !loaded.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) loaded.current.add(id);
    const forUser = userId;
    listMarks(missing)
      .then((found) => {
        // Dropped if the screen closed or another account signed in meanwhile.
        // Taps made while loading win over what the server had.
        if (mounted.current && loadedFor.current === forUser) setById((cur) => ({ ...found, ...cur }));
      })
      .catch(() => {
        // Not fatal: the chips start empty and can still be tapped. Try again next time.
        for (const id of missing) loaded.current.delete(id);
      });
    // `key` stands for the list of ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, userId, key]);

  const get = useCallback((messageId: string) => byId[messageId] ?? NONE, [byId]);

  const toggle = useCallback(
    (messageId: string, mark: Mark) => {
      if (!userId) return;
      const before = byId[messageId] ?? NONE;
      const on = !before.marks.includes(mark);
      const after: AnswerMarks = {
        marks: on ? [...before.marks, mark] : before.marks.filter((m) => m !== mark),
        note: before.note,
      };
      setById((cur) => ({ ...cur, [messageId]: after }));
      const call = on ? addMark(userId, messageId, mark, before.note) : removeMark(userId, messageId, mark);
      call.catch(() => {
        setById((cur) => ({ ...cur, [messageId]: before }));
        onError();
      });
    },
    [byId, userId, onError],
  );

  const setNote = useCallback(
    async (messageId: string, note: string) => {
      if (!userId) return false;
      const before = byId[messageId] ?? NONE;
      const clean = note.trim() || null;
      setById((cur) => ({ ...cur, [messageId]: { ...before, note: clean } }));
      try {
        await saveNote(userId, messageId, clean);
        return true;
      } catch {
        setById((cur) => ({ ...cur, [messageId]: before }));
        onError();
        return false;
      }
    },
    [byId, userId, onError],
  );

  return { get, toggle, setNote };
}
