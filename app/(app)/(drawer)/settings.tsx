import { useState } from 'react';

import { LanguageSwitcher } from '../../../components/dev/LanguageSwitcher';
import { Divider, ListRow, Screen, SectionHeader, Switch, Text, Title, TopBar } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { LIGHT_ONLY_LAUNCH, useTheme } from '../../../theme';

export default function Settings() {
  const { t, canSwitchLanguage } = useI18n();
  const { locked } = useTheme();
  const [notifications, setNotifications] = useState(true);
  const [voice, setVoice] = useState(true);
  const [haptics, setHaptics] = useState(true);

  return (
    <Screen scroll>
      <TopBar menu />

      <Title center className="pt-sm">
        {t('settings.title')}
      </Title>

      <SectionHeader title={t('settings.notifications')} />
      <Switch value={notifications} onChange={setNotifications} label={t('settings.notifications')} />
      <Switch value={voice} onChange={setVoice} label={t('settings.voice')} />
      <Switch value={haptics} onChange={setHaptics} label={t('settings.haptics')} />

      <Divider className="my-md" />
      <ListRow icon="info" title={t('legal.aiDisclosure')} onPress={() => {}} />

      {/* Dev-only controls; not rendered in production builds. */}
      {canSwitchLanguage ? (
        <>
          <SectionHeader title={t('settings.language')} />
          <Text variant="micro" tone="tertiary">
            {t('settings.languageDevNote')}
          </Text>
          <LanguageSwitcher className="mt-xs self-start" />
          {LIGHT_ONLY_LAUNCH && locked ? (
            <Text variant="micro" tone="tertiary" className="pt-md">
              Theme locked to light for launch, see theme/config.ts
            </Text>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
