import { useEventListener } from 'expo';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useRef, useState } from 'react';
import { Image, View, type LayoutChangeEvent } from 'react-native';

import { LiquidButton, ProgressBar, Screen, Text, TextButton } from '../components/ui';
import { useI18n } from '../i18n';
import { useTheme, withAlpha } from '../theme';

const INTRO = require('../assets/video/intro.mp4');
const POSTER = require('../assets/video/intro-poster.jpg');

/**
 * Welcome video. The top and bottom of the video fade into a flat background
 * colour so there's no visible frame. Fades end in the same hue at zero alpha,
 * not `transparent` (which is black on Android and leaves a grey band).
 */

/** Fade depth, top and bottom. */
const FADE_TOP = 96;
const FADE_BOTTOM = 176;

/** Video is 1290 × 2796. */
const VIDEO_ASPECT = 1290 / 2796;

/**
 * Crop anchor (0 = crop from bottom, 0.5 = centred). A quarter keeps the head
 * in frame while leaving the burned-in captions clear of the bottom fade.
 */
const CROP_BIAS = 0.25;

export default function Intro() {
  const { t } = useI18n();
  const { colors, shadow } = useTheme();
  const router = useRouter();
  const [firstFrame, setFirstFrame] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [box, setBox] = useState({ width: 0, height: 0 });

  const player = useVideoPlayer(INTRO, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.25;
    p.play();
  });

  // Guard against playToEnd and a button tap both navigating in the same frame.
  const left = useRef(false);
  const onward = useCallback(() => {
    if (left.current) return;
    left.current = true;
    router.replace('/profile-setup');
  }, [router]);

  useEventListener(player, 'playToEnd', onward);
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    if (!left.current) setElapsed(currentTime);
  });

  // No pause on unmount: useVideoPlayer releases the player before effect cleanup
  // runs, so calling it there throws. The hook owns the lifecycle.

  const duration = player.duration || 20;
  const remaining = Math.max(0, Math.ceil(duration - elapsed));
  const clock = `00:${String(remaining).padStart(2, '0')}`;

  // Flat background colour that both fades resolve to.
  const ground = colors.brandLavenderShadow;
  const clear = withAlpha(ground, 0);

  /**
   * The video is laid out at its own aspect ratio and clipped by the box, which
   * is how the crop anchor is applied (`contentFit` has no anchor).
   */
  const filmHeight = box.width ? box.width / VIDEO_ASPECT : 0;
  const film =
    box.width && filmHeight > box.height
      ? {
          position: 'absolute' as const,
          left: 0,
          top: -(filmHeight - box.height) * CROP_BIAS,
          width: box.width,
          height: filmHeight,
        }
      : { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

  const onFilmLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (b.width === width && b.height === height ? b : { width, height }));
  };

  return (
    <View className="flex-1" style={{ backgroundColor: ground }}>
      <Screen padded={false}>
        <View className="px-gutter pt-xs">
          <ProgressBar value={duration ? elapsed / duration : 0} />
          <View className="flex-row items-center justify-between pt-sm">
            <Text variant="micro" tone="tertiary">
              {clock}
            </Text>
            <TextButton title={t('common.skip')} tone="secondary" onPress={onward} />
          </View>
        </View>

        <View className="flex-1 overflow-hidden" onLayout={onFilmLayout}>
          <VideoView
            style={film}
            player={player}
            nativeControls={false}
            contentFit="cover"
            allowsPictureInPicture={false}
            onFirstFrameRender={() => setFirstFrame(true)}
          />
          {/* Poster uses the same geometry as the video so nothing jumps on the first frame. */}
          {firstFrame ? null : <Image source={POSTER} style={film} resizeMode="cover" />}

          <LinearGradient
            colors={[ground, clear]}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: FADE_TOP }}
            pointerEvents="none"
          />
          <LinearGradient
            colors={[clear, ground]}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: FADE_BOTTOM }}
            pointerEvents="none"
          />

          <View className="absolute bottom-0 left-0 right-0 px-gutter pb-xl">
            <View
              style={shadow.sm}
              className="self-start rounded-card bg-surface px-md py-sm">
              <Text variant="bodyMedium">Claudia Simon</Text>
              <Text variant="micro" tone="tertiary" className="pt-xxs">
                zakladatelka SAOHLIN AI™
              </Text>
            </View>
          </View>
        </View>

        <View className="px-gutter pb-lg pt-xs">
          <LiquidButton title={t('common.continue')} onPress={onward} />
        </View>
      </Screen>
    </View>
  );
}
