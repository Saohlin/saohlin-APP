import { useState } from 'react';

import { useSession, type UserSettings } from '../../../auth';
import { LanguageSwitcher } from '../../../components/dev/LanguageSwitcher';
import {
  Banner,
  Dialog,
  Divider,
  ListRow,
  Screen,
  SectionHeader,
  Switch,
  Text,
  Title,
  TopBar,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { authErrorKey } from '../../../lib/authErrors';
import { LIGHT_ONLY_LAUNCH, useTheme } from '../../../theme';

export default function Settings() {
  const { t, canSwitchLanguage } = useI18n();
  const { locked } = useTheme();
  const { settings, updateSettings, signOut, deleteAccount } = useSession();
  const [confirm, setConfirm] = useState<'signOut' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const toggle = (key: keyof UserSettings) => (value: boolean) => {
    setError(undefined);
    updateSettings({ [key]: value }).catch((e) => setError(t(authErrorKey(e))));
  };

  // Leaving the session sends the user out of the signed-in area via the guards.
  const run = async (action: () => Promise<void>) => {
    setConfirm(null);
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      setError(t(authErrorKey(e)));
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <TopBar menu />

      <Title center className="pt-sm">
        {t('settings.title')}
      </Title>

      {error ? <Banner tone="warning" message={error} className="mt-md" /> : null}

      <SectionHeader title={t('settings.notifications')} />
      <Switch value={settings.notifications} onChange={toggle('notifications')} label={t('settings.notifications')} />
      <Switch value={settings.voicePlayback} onChange={toggle('voicePlayback')} label={t('settings.voice')} />
      <Switch value={settings.haptics} onChange={toggle('haptics')} label={t('settings.haptics')} />

      <Divider className="my-md" />
      <ListRow icon="info" title={t('legal.aiDisclosure')} onPress={() => {}} />

      <SectionHeader title={t('settings.account')} />
      <ListRow title={t('auth.signOut')} disabled={busy} onPress={() => setConfirm('signOut')} />
      <ListRow
        title={t('legal.deleteAccount')}
        destructive
        disabled={busy}
        onPress={() => setConfirm('delete')}
      />
      {busy ? (
        <Text variant="micro" tone="tertiary" className="pt-xs">
          {t('common.loading')}
        </Text>
      ) : null}

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

      <Dialog
        visible={confirm === 'signOut'}
        onClose={() => setConfirm(null)}
        title={t('settings.signOutTitle')}
        message={t('settings.signOutMessage')}
        confirmLabel={t('auth.signOut')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => run(signOut)}
      />
      <Dialog
        visible={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={t('legal.deleteAccountTitle')}
        message={t('legal.deleteAccountMessage')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => run(deleteAccount)}
      />
    </Screen>
  );
}
