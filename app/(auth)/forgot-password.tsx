import { useState } from 'react';

import { Banner, LiquidButton, Screen, TextField, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

export default function ForgotPassword() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <Screen footer={!sent ? <LiquidButton title={t('common.continue')} onPress={() => setSent(true)} /> : undefined}>
      <Title center className="pt-xl">
        {t('auth.forgotPassword')}
      </Title>
      {sent ? (
        <Banner tone="success" message={t('feedback.sent')} className="mt-xl" />
      ) : (
        <TextField
          label={t('auth.email')}
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          className="mt-xl"
        />
      )}
    </Screen>
  );
}
