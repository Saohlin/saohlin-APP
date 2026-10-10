import { useLocalSearchParams } from 'expo-router';

import { EntryEditor } from '../../../components/journal';

/** New journal entry. `?day=YYYY-MM-DD` writes it for an earlier day of the week. */
export default function NewJournalEntry() {
  const { day } = useLocalSearchParams<{ day?: string }>();
  return <EntryEditor day={day} />;
}
