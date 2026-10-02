import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { useSession, type DeeperAnswers } from '../../../auth';
import {
  Dialog,
  GlassCard,
  IconButton,
  InlineMessage,
  LiquidButton,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
  TextButton,
  Title,
  TopBar,
} from '../../../components/ui';
import { clearMemory, forgetNote, getMemory, type Memory as MemoryData } from '../../../lib/api/memory';
import { useI18n } from '../../../i18n';
import type { Dictionary, Path } from '../../../i18n';

const ANSWERS: Array<{ key: keyof DeeperAnswers; label: Path<Dictionary> }> = [
  { key: 'work', label: 'onboarding.work' },
  { key: 'situation', label: 'onboarding.situation' },
  { key: 'blocking', label: 'onboarding.blocking' },
  { key: 'visions', label: 'onboarding.visions' },
];

const GENDER_LABEL: Record<string, Path<Dictionary>> = {
  female: 'onboarding.genderFemale',
  male: 'onboarding.genderMale',
  other: 'onboarding.genderOther',
  unspecified: 'onboarding.genderUnspecified',
};

function displayDob(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}. ${m}. ${y}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <GlassCard className="mt-sm">
      <Text variant="label" tone="secondary">
        {label}
      </Text>
      <Text variant="body" className="pt-xxs">
        {value}
      </Text>
    </GlassCard>
  );
}

/**
 * Screen 34. Everything CLAUDIA AI knows about the user, in three parts:
 * the profile and answers (editable), the facts it noted from conversations
 * (each can be forgotten), and the summaries of past conversations.
 * "Forget everything" clears the last two; the profile stays.
 */
export default function Memory() {
  const { t } = useI18n();
  const router = useRouter();
  const { profile, context } = useSession();
  const [memory, setMemory] = useState<MemoryData | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Ignore a slow response that arrives after a newer one.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const m = await getMemory();
      if (seq !== loadSeq.current) return;
      setMemory(m);
      setFailed(false);
    } catch {
      if (seq === loadSeq.current) setFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const forget = async (id: string) => {
    if (busy || !memory) return;
    setBusy(true);
    // A load still on its way would bring the note back: make it stale.
    loadSeq.current++;
    // Gone from the screen at once.
    setMemory({ ...memory, notes: memory.notes.filter((n) => n.id !== id) });
    try {
      await forgetNote(id);
      setFailed(false);
    } catch {
      // Show what the server really has, not what we guessed.
      await load();
    } finally {
      setBusy(false);
    }
  };

  const forgetAll = async () => {
    setConfirming(false);
    if (busy) return;
    setBusy(true);
    try {
      await clearMemory();
      setMemory({ notes: [], conversations: [], momentsCount: 0 });
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const hasLearned = !!memory && (memory.notes.length > 0 || memory.conversations.length > 0 || memory.momentsCount > 0);

  return (
    <Screen
      scroll
      footer={
        <View className="pb-lg">
          <LiquidButton title={t('profile.edit')} onPress={() => router.push('/profile/edit')} />
        </View>
      }>
      <TopBar onBack={() => router.back()} />

      <Title center className="pt-sm">
        {t('profile.memoryTitle')}
      </Title>
      <Text variant="caption" tone="secondary" center className="pt-sm">
        {t('profile.memoryIntro')}
      </Text>

      <SectionHeader title={t('profile.memoryBasics')} className="pt-lg" />
      <Fact label={t('onboarding.howToAddress')} value={profile?.displayName ?? '-'} />
      <Fact label={t('profile.vocative')} value={profile?.vocative ?? '-'} />
      {profile?.dateOfBirth ? (
        <Fact label={t('onboarding.dateOfBirth')} value={displayDob(profile.dateOfBirth)} />
      ) : null}
      {profile?.zodiac ? (
        <Fact label={t('profile.zodiac')} value={t(`zodiac.${profile.zodiac}` as Path<Dictionary>)} />
      ) : null}
      {profile?.gender && profile.gender !== 'unspecified' ? (
        <Fact label={t('onboarding.gender')} value={t(GENDER_LABEL[profile.gender])} />
      ) : null}

      <SectionHeader title={t('profile.memoryAnswers')} className="pt-lg" />
      {ANSWERS.map(({ key, label }) => (
        <Fact key={key} label={t(label)} value={context[key] || t('profile.notAnswered')} />
      ))}

      <SectionHeader title={t('profile.memoryNotes')} className="pt-lg" />
      {failed ? (
        <View className="flex-row items-center justify-between pt-sm">
          <InlineMessage message={t('profile.memoryLoadFailed')} className="flex-1" />
          <TextButton title={t('common.tryAgain')} onPress={() => void load()} />
        </View>
      ) : null}
      {!memory && !failed ? <SkeletonList rows={2} className="pt-sm" /> : null}
      {memory && memory.notes.length === 0 ? (
        <Text variant="body" tone="secondary" className="pt-sm">
          {t('profile.memoryEmpty')}
        </Text>
      ) : null}
      {memory?.notes.map((n) => (
        <GlassCard key={n.id} className="mt-sm flex-row items-center gap-sm">
          <Text variant="body" className="flex-1">
            {n.content}
          </Text>
          <IconButton
            name="trash"
            variant="plain"
            size={36}
            label={t('profile.forgetOne')}
            disabled={busy}
            onPress={() => void forget(n.id)}
          />
        </GlassCard>
      ))}

      {memory && memory.conversations.length > 0 ? (
        <>
          <SectionHeader title={t('profile.memoryConversations')} className="pt-lg" />
          {memory.conversations.map((c) => (
            <GlassCard key={c.id} className="mt-sm">
              {c.title ? (
                <Text variant="label" tone="secondary">
                  {c.title}
                </Text>
              ) : null}
              <Text variant="body" className="pt-xxs">
                {c.summary}
              </Text>
            </GlassCard>
          ))}
        </>
      ) : null}

      {hasLearned ? (
        <View className="items-center pb-xl pt-lg">
          <TextButton title={t('profile.forgetAll')} tone="error" disabled={busy} onPress={() => setConfirming(true)} />
          <Text variant="caption" tone="secondary" center className="pt-xs">
            {t('profile.forgetAllKeeps')}
          </Text>
        </View>
      ) : (
        <View className="pb-xl" />
      )}

      <Dialog
        visible={confirming}
        onClose={() => setConfirming(false)}
        title={t('profile.forgetAllTitle')}
        message={t('profile.forgetAllMessage')}
        confirmLabel={t('profile.forgetAll')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void forgetAll()}
        destructive
      />
    </Screen>
  );
}
