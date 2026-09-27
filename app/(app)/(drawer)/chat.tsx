import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useSession } from '../../../auth';
import {
  ChatBubble,
  ChatComposer,
  ListRow,
  Screen,
  Sheet,
  Text,
  TopBar,
  TypingIndicator,
} from '../../../components/ui';
import { useI18n } from '../../../i18n';

/**
 * Chat with CLAUDIA AI. The first reply is often a question, and reply length
 * varies a lot by mode, so the layout must not assume long answers.
 */
export default function Chat() {
  const { t } = useI18n();
  const { profile } = useSession();
  const [draft, setDraft] = useState('');
  const [thinking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Capitalise only the first letter; names like `van der Berg` must stay as typed.
  const vocative = profile?.vocative?.trim() || 'Terezo';
  const name = vocative.charAt(0).toUpperCase() + vocative.slice(1);

  return (
    <Screen
      padded={false}
      avoidKeyboard
      footer={
        <View className="px-gutter">
          <ChatComposer
            value={draft}
            onChangeText={setDraft}
            onSend={() => setDraft('')}
            onMic={() => {}}
          />
        </View>
      }>
      <View className="px-gutter">
        <TopBar
          menu
          title={t('nav.chat')}
          action="more"
          actionVariant="plain"
          actionLabel={t('a11y.more')}
          onActionPress={() => setMenuOpen(true)}
        />
      </View>

      <ScrollView className="flex-1 px-gutter" contentContainerClassName="gap-lg pb-md">
        <View className="items-center gap-xxs pb-xl pt-xl">
          <Text variant="greeting" center>
            {t('chat.greeting', { name })}
          </Text>
          <Text variant="caption" tone="default" center>
            {t('chat.prompt')}
          </Text>
        </View>

        {/* TODO: real messages from the conversation store. */}
        <ChatBubble
          sender="user"
          label={profile?.displayName}
          text="Mám radost. Dnes chci pracovat na své aplikaci."
        />
        <ChatBubble
          sender="ai"
          showActions
          text={'To zní jako krásný začátek.\n\nCo tě k tomu vedlo právě teď?'}
        />
        {thinking ? <TypingIndicator /> : null}
      </ScrollView>

      {/* History is shown disabled until its screen exists. */}
      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} title={t('nav.chat')}>
        <ListRow
          icon="plus"
          title={t('chat.newConversation')}
          showChevron={false}
          onPress={() => {
            // TODO: clear the conversation store once it exists.
            setDraft('');
            setMenuOpen(false);
          }}
        />
        <ListRow
          icon="clock"
          title={t('chat.history')}
          showChevron={false}
          disabled
          onPress={() => setMenuOpen(false)}
        />
      </Sheet>
    </Screen>
  );
}
