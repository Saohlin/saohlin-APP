import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { Banner, LiquidButton, Screen, TextField, Title } from '../../components/ui';
import { useI18n } from '../../i18n';

// Opened from the reset link. A missing or expired token shows a recovery state.
export default function ResetPassword() {
  const { t } = useI18n();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const [password, setPassword] = useState('');

  if (!token) {
    return (
      <Screen footer={<LiquidButton title={t('auth.forgotPassword')} onPress={() => router.replace('/forgot-password')} />}>
        <Banner tone="warning" message={t('validation.linkExpired')} className="mt-xl" />
      </Screen>
    );
  }

  return (
    <Screen footer={<LiquidButton title={t('common.save')} onPress={() => router.replace('/sign-in')} />}>
      <Title center className="pt-xl">
        {t('auth.resetPassword')}
      </Title>
      <TextField
        label={t('auth.password')}
        placeholder={t('auth.passwordPlaceholder')}
        value={password}
        onChangeText={setPassword}
        password
        className="mt-xl"
      />
    </Screen>
  );
}
