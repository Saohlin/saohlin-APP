import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { useSession, type UserSettings } from '../../../auth';
import { LanguageSwitcher } from '../../../components/dev/LanguageSwitcher';
import {
  Banner,
  Dialog,
  Icon,
  Screen,
  SectionHeader,
  SoftCard,
  Switch,
  Text,
  TopBar,
  cx,
  type IconName,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { authErrorKey } from '../../../lib/authErrors';
import { openLegal } from '../../../lib/legal';
import { LIGHT_ONLY_LAUNCH, useTheme } from '../../../theme';

/** The round glass badge that carries a row's glyph. */
function Bead({ icon, destructive }: { icon: IconName; destructive?: boolean }) {
  const { colors } = useTheme();
  return (
    <View className="h-[36px] w-[36px] items-center justify-center rounded-pill border border-edge bg-glass/glass-soft">
      <Icon name={icon} size={17} color={destructive ? colors.errorFg : colors.accent} />
    </View>
  );
}

/** Related rows in one soft glass card, the way the profile groups its facts. */
function Group({ children }: { children: ReactNode }) {
  return <SoftCard padding="px-md">{children}</SoftCard>;
}

/** A row that goes somewhere or does something: badge, title, chevron. */
function LinkRow({
  icon,
  title,
  onPress,
  destructive,
  disabled,
  last,
}: {
  icon: IconName;
  title: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  /** No hairline under the last row of a group. */
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cx(
        'flex-row items-center gap-sm py-sm active:opacity-70',
        !last && 'border-b border-edge-subtle',
        disabled && 'opacity-45',
      )}>
      <Bead icon={icon} destructive={destructive} />
      <Text variant="chat" tone={destructive ? 'error' : 'default'} numberOfLines={2} className="flex-1">
        {title}
      </Text>
      <Icon name="chevron-right" size={15} />
    </Pressable>
  );
}

/** A preference: badge, what it is, one line on what it does, and the switch. */
function ToggleRow({
  icon,
  label,
  description,
  value,
  onChange,
  last,
}: {
  icon: IconName;
  label: string;
  description?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  last?: boolean;
}) {
  return (
    <View className={cx('flex-row items-center gap-sm', !last && 'border-b border-edge-subtle')}>
      <Bead icon={icon} />
      <View className="flex-1">
        <Switch value={value} onChange={onChange} label={label} description={description} />
      </View>
    </View>
  );
}

export default function Settings() {
  const { t, canSwitchLanguage } = useI18n();
  const router = useRouter();
  const { locked } = useTheme();
  const { session, settings, updateSettings, signOut, deleteAccount } = useSession();
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
    <Screen scroll header={<TopBar onBack={() => (router.canGoBack() ? router.back() : router.replace('/chat'))} />}>
      <Text variant="title" center className="pt-xs">
        {t('settings.title')}
      </Text>
      <Text variant="caption" center className="self-center pt-xs max-w-[260px]">
        {t('settings.subtitle')}
      </Text>

      {error ? <Banner tone="warning" message={error} className="mt-md" /> : null}

      {/* Notifications are switched off for now. To bring them back, add this as the
         first row of the Preferences group:
      <ToggleRow icon="mail" label={t('settings.notifications')} value={settings.notifications} onChange={toggle('notifications')} />
      */}
      <SectionHeader title={t('settings.preferences')} className="pt-lg" />
      <Group>
        <ToggleRow
          icon="speaker"
          label={t('settings.voice')}
          description={t('settings.voiceHint')}
          value={settings.voicePlayback}
          onChange={toggle('voicePlayback')}
        />
        <ToggleRow
          icon="heart"
          label={t('settings.haptics')}
          description={t('settings.hapticsHint')}
          value={settings.haptics}
          onChange={toggle('haptics')}
          last
        />
      </Group>

      <SectionHeader title={t('settings.privacy')} className="pt-lg" />
      <Group>
        {/* "What CLAUDIA AI remembers about me" is switched off for now. To bring it back,
           add this as the first row of this group:
        <LinkRow icon="clock" title={t('profile.memoryTitle')} onPress={() => router.push('/profile/memory')} />
        */}
        {/* No page of its own yet, so it opens the privacy policy for now. */}
        <LinkRow icon="info" title={t('legal.aiDisclosure')} onPress={() => openLegal('privacy')} />
        <LinkRow icon="shield" title={t('legal.privacy')} onPress={() => openLegal('privacy')} />
        <LinkRow icon="journal" title={t('legal.terms')} onPress={() => openLegal('terms')} last />
      </Group>

      <SectionHeader title={t('settings.account')} className="pt-lg" />
      <Group>
        {session?.email ? (
          <View className="flex-row items-center gap-sm border-b border-edge-subtle py-sm">
            <Bead icon="mail" />
            <View className="flex-1 gap-xxs">
              <Text variant="label" tone="tertiary">
                {t('auth.email')}
              </Text>
              <Text variant="chat" tone="secondary" numberOfLines={1}>
                {session.email}
              </Text>
            </View>
          </View>
        ) : null}
        <LinkRow icon="forward" title={t('auth.signOut')} disabled={busy} onPress={() => setConfirm('signOut')} />
        <LinkRow
          icon="trash"
          title={t('legal.deleteAccount')}
          destructive
          disabled={busy}
          onPress={() => setConfirm('delete')}
          last
        />
      </Group>
      {busy ? (
        <Text variant="micro" tone="tertiary" center className="pt-xs">
          {t('common.loading')}
        </Text>
      ) : null}

      {/* Dev-only controls; not rendered in production builds. */}
      {canSwitchLanguage ? (
        <>
          <SectionHeader title={t('settings.language')} className="pt-lg" />
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
        plainCancel
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
        plainCancel
        onConfirm={() => run(deleteAccount)}
      />
    </Screen>
  );
}
