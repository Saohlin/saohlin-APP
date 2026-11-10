import { useDrawerProgress, type DrawerContentComponentProps } from 'expo-router/drawer';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MeshBackdrop } from '../brand/MeshBackdrop';
// Import leaf modules, not the ui barrel, to avoid a circular import via TopBar.
import { IconButton } from '../ui/Button';
import { Icon, type IconName } from '../ui/Icon';
import { Divider } from '../ui/Screen';
import { Text } from '../ui/Text';
import { useI18n, type Dictionary, type Path } from '../../i18n';
import { space, useTheme } from '../../theme';

/**
 * Navigation drawer panel. It has no background of its own: it renders a second
 * copy of the mesh, clipped to the panel and counter-translated against the
 * drawer animation so the background stays fixed while the panel slides over it.
 * No border or shadow; the dimmed content provides the edge.
 */

export const DRAWER_WIDTH_RATIO = 0.72;
export const SCRIM_ALPHA = 0.24;

const M = {
  closeRow: 40,
  closeIcon: 16,
  titleTop: 58,
  dividerTop: 39,
  itemsTop: 22,
  rowHeight: 63,
  rowInset: 32,
  iconColumn: 22,
  iconToLabel: 18,
} as const;

/**
 * Drawer destinations. `route` is the file name in `app/(app)/(drawer)/`, so this
 * array is the single place the navigator and the panel agree on.
 */
export const DRAWER_ITEMS: ReadonlyArray<{
  route: string;
  icon: IconName;
  label: Path<Dictionary>;
}> = [
  { route: 'chat', icon: 'chat', label: 'nav.chat' },
  { route: 'cards', icon: 'cards', label: 'nav.cards' },
  { route: 'journal', icon: 'journal', label: 'nav.journal' },
  { route: 'profile', icon: 'profile', label: 'nav.profile' },
  { route: 'settings', icon: 'settings', label: 'nav.settings' },
  { route: 'feedback', icon: 'mail', label: 'nav.writeToMe' },
];

/** Off: all items share the same style. Screen readers still get `accessibilityState`. */
const ACTIVE_MARK = false;

export function DrawerPanel({ state, navigation }: DrawerContentComponentProps) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const progress = useDrawerProgress();

  const current = state.routeNames[state.index];

  // The panel is at -width when closed and 0 when open; moving the backdrop the
  // other way by the same amount leaves it standing still on the screen.
  const panelWidth = Math.round(width * DRAWER_WIDTH_RATIO);
  const still = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - progress.value) * panelWidth }],
  }));

  return (
    <View className="flex-1 overflow-hidden">
      <Animated.View
        style={[{ position: 'absolute', top: 0, left: 0, width, bottom: 0 }, still]}
        pointerEvents="none">
        <MeshBackdrop />
      </Animated.View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + space.lg }}>
        <View style={{ height: M.closeRow, paddingLeft: space.gutter }} className="justify-center">
          <IconButton
            variant="plain"
            size={M.closeIcon + 12}
            iconSize={M.closeIcon}
            iconColor={colors.textSecondary}
            name="close"
            label={t('a11y.close')}
            onPress={() => navigation.closeDrawer()}
            className="self-start"
          />
        </View>

        <Text variant="title" center style={{ marginTop: M.titleTop }}>
          {t('brand.name')}
        </Text>

        <View className="px-gutter" style={{ marginTop: M.dividerTop }}>
          <Divider />
        </View>

        <View style={{ marginTop: M.itemsTop }}>
          {DRAWER_ITEMS.map((item) => {
            const on = item.route === current;
            return (
              <Pressable
                key={item.route}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => navigation.navigate(item.route)}
                style={{ height: M.rowHeight, paddingLeft: M.rowInset }}
                className="flex-row items-center active:opacity-60">
                <View style={{ width: M.iconColumn }}>
                  <Icon name={item.icon} size={M.iconColumn} color={colors.textSecondary} />
                </View>
                <Text
                  variant="navItem"
                  tone={ACTIVE_MARK && !on ? 'secondary' : 'default'}
                  style={{ marginLeft: M.iconToLabel }}
                  numberOfLines={1}>
                  {t(item.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
