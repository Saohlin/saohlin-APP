import { View } from 'react-native';

import { DrawerToggle } from '../nav/DrawerToggle';
import { IconButton, type IconButtonVariant } from './Button';
import { type IconName } from './Icon';
import { Text } from './Text';
import { cx } from './cx';
import { useT } from '../../i18n';

/**
 * Top bar: a left slot (menu or back, never both), a title and one optional
 * action. `menu` renders the bare glyph, `onBack` the glass circle.
 */
export function TopBar({
  title,
  menu,
  menuDisabled,
  onBack,
  action,
  onActionPress,
  actionLabel,
  actionVariant,
  className,
}: {
  title?: string;
  /** Opens the navigation drawer. Only valid inside the drawer group. */
  menu?: boolean;
  /** Holds the drawer shut, e.g. while a chat message is in flight. */
  menuDisabled?: boolean;
  onBack?: () => void;
  action?: IconName;
  onActionPress?: () => void;
  actionLabel?: string;
  /** `plain` for a bare glyph. Otherwise the app's bead — see IconButton. */
  actionVariant?: IconButtonVariant;
  className?: string;
}) {
  const t = useT();
  return (
    <View className={cx('h-[44px] w-full flex-row items-center justify-between', className)}>
      <View className="w-[40px] justify-center">
        {menu ? (
          <DrawerToggle disabled={menuDisabled} />
        ) : onBack ? (
          <IconButton name="back" label={t('a11y.back')} onPress={onBack} />
        ) : null}
      </View>
      {title ? (
        <Text variant="title" center className="flex-1">
          {title}
        </Text>
      ) : (
        <View className="flex-1" />
      )}
      <View className="w-[40px] items-end">
        {action ? (
          <IconButton
            name={action}
            label={actionLabel ?? t('a11y.action')}
            onPress={onActionPress}
            variant={actionVariant}
          />
        ) : null}
      </View>
    </View>
  );
}
