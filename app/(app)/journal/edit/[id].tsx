import { useLocalSearchParams } from 'expo-router';

import { EntryEditor } from '../../../../components/journal';

/** Edit a journal entry. */
export default function EditJournalEntry() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EntryEditor entryId={id} />;
}
