import { Drawer } from 'expo-router/drawer';
import { useWindowDimensions } from 'react-native';

import { DrawerPanel, DRAWER_ITEMS, DRAWER_WIDTH_RATIO, SCRIM_ALPHA } from '../../../components/nav';
import { useI18n } from '../../../i18n';
import { useTheme, withAlpha } from '../../../theme';

/**
 * Main navigation is a left drawer (no bottom tab bar).
 * Uses expo-router's built-in drawer, so no extra native dependency.
 * Screens render their own TopBar inside Screen, which owns the safe-area
 * inset; a navigator header would apply the inset twice.
 */
export default function DrawerLayout() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { width } = useWindowDimensions();

  return (
    <Drawer
      drawerContent={(props) => <DrawerPanel {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'front',
        drawerPosition: 'left',
        // Transparent: the panel paints its own copy of the mesh background.
        drawerStyle: {
          width: Math.round(width * DRAWER_WIDTH_RATIO),
          backgroundColor: 'transparent',
        },
        overlayColor: withAlpha(colors.scrim, SCRIM_ALPHA),
        sceneStyle: { backgroundColor: 'transparent' },
        swipeEdgeWidth: 56,
        keyboardDismissMode: 'on-drag',
      }}>
      {DRAWER_ITEMS.map((item) => (
        <Drawer.Screen key={item.route} name={item.route} options={{ title: t(item.label) }} />
      ))}
    </Drawer>
  );
}
