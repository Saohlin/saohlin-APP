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
    // box-none: in a floating header, only the buttons take touches; the rest scrolls what is underneath.
    <View pointerEvents="box-none" className={cx('h-[44px] w-full flex-row items-center justify-between', className)}>
      <View pointerEvents="box-none" className="w-[40px] justify-center">
        {menu ? (
          <DrawerToggle disabled={menuDisabled} />
        ) : onBack ? (
          <IconButton name="back" label={t('a11y.back')} onPress={onBack} />
        ) : null}
      </View>
      {title ? (
        // One line, shrinking to fit: a long title must not run into the side buttons.
        <Text variant="title" center numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} className="flex-1 px-sm">
          {title}
        </Text>
      ) : (
        <View className="flex-1" />
      )}
      <View pointerEvents="box-none" className="w-[40px] items-end">
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
