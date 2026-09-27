import { useNavigation } from 'expo-router';
import type { DrawerNavigationProp } from 'expo-router/drawer';

import { IconButton } from '../ui/Button';
import { useT } from '../../i18n';
import { useTheme } from '../../theme';

// Menu button. Finds the nearest drawer navigator itself, so screens just render <TopBar menu />.
export function DrawerToggle() {
  const t = useT();
  const { colors } = useTheme();
  const navigation = useNavigation<DrawerNavigationProp<Record<string, undefined>>>();

  return (
    <IconButton
      variant="plain"
      size={32}
      iconSize={20}
      iconColor={colors.textSecondary}
      name="menu"
      label={t('a11y.menu')}
      onPress={() => navigation.openDrawer()}
      className="self-start"
    />
  );
}
