import { useLocalSearchParams } from 'expo-router';

import { Screen, Text, Title } from '../../components/ui';
import { useI18n } from '../../i18n';
import type { Dictionary, Path } from '../../i18n';

// Privacy policy, terms and AI disclosure. Public so they're reachable without an account.
const TITLES: Record<string, Path<Dictionary>> = {
  privacy: 'legal.privacy',
  terms: 'legal.terms',
  ai: 'legal.aiDisclosure',
};

export default function LegalDoc() {
  const { t } = useI18n();
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const key = TITLES[doc ?? ''] ?? 'legal.terms';

  return (
    <Screen scroll>
      <Title className="pt-lg">{t(key)}</Title>
      {/* TODO: final reviewed Czech text. */}
      <Text variant="caption" className="pt-lg">
        {t('cards.descriptionPending')}
      </Text>
    </Screen>
  );
}
