import { haptic } from '../lib/haptics';
import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';

import { mesh } from '../theme';

import { HOME_FOR, useSession } from '../auth';
import { ResetSession } from '../components/dev/ResetSession';
import { LiquidButton, Text } from '../components/ui';
import { useI18n } from '../i18n';

const SPLASH = require('../assets/video/splash.mp4');
const POSTER = require('../assets/video/splash-poster.png');

/**
 * Splash video and entry button. First launch plays with sound and two haptics
 * timed to the logo animation; returning users get a short, silent tail.
 */
const IGNITION_MS = 1730;
const FLARE_MS = 2470;

/** Where first-launch playback starts. Haptics earlier than this are skipped. */
const FIRST_SEEK_S = 1;

/** Where a returning user's playback starts, so the brand never holds them. */
const RETURNING_SEEK_S = 2.8;

/** Credit block offset from the bottom, as a fraction of screen height. */
const CREDIT_BASELINE = 0.1426;

export default function Entry() {
  const { status } = useSession();
  const { width, height } = useWindowDimensions();
  const { t } = useI18n();
  const router = useRouter();
  const [firstFrame, setFirstFrame] = useState(false);

  // Returning users get the tail of the animation, muted and without haptics.
  const returning = status !== 'guest' && status !== 'restoring';

  const player = useVideoPlayer(SPLASH, (p) => {
    p.loop = false;
    p.muted = returning;
    p.timeUpdateEventInterval = 0;
    p.currentTime = returning ? RETURNING_SEEK_S : FIRST_SEEK_S;
    p.play();
  });

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (returning) return;
    // Haptics are timed against the video, so they shift with the start point
    // and any that fall before it are dropped.
    const cues: [number, () => void][] = [
      [IGNITION_MS, haptic.tap],
      [FLARE_MS, haptic.thump],
    ];
    timers.current = cues
      .map(([at, fire]) => [at - FIRST_SEEK_S * 1000, fire] as const)
      .filter(([delay]) => delay >= 0)
      .map(([delay, fire]) => setTimeout(fire, delay));
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [returning]);

  const enter = () => {
    // New visitors get the intro video. Anyone with an account resumes at the
    // step they left (verification, profile, the four questions, or the chat),
    // so closing the app mid-onboarding never restarts it from the first screen.
    const home = status === 'guest' || status === 'restoring' ? null : HOME_FOR[status];
    if (home) router.replace(home);
    else router.push('/intro');
  };

  return (
    // Matches the native launch screen colour to avoid a flash on cold start.
    <View className="flex-1" style={{ backgroundColor: mesh.light.base }}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        nativeControls={false}
        contentFit="cover"
        allowsPictureInPicture={false}
        onFirstFrameRender={() => setFirstFrame(true)}
      />

      {/* Poster frame until the first video frame is decoded. */}
      {firstFrame ? null : (
        // Explicit size, since an Image lays out at its intrinsic size.
        <Image
          source={POSTER}
          style={{ position: 'absolute', top: 0, left: 0, width, height }}
          resizeMode="cover"
        />
      )}

      {/* Button block positioned as a fraction of screen height so the layout holds across devices. */}
      <View
        className="flex-1 justify-end px-gutter"
        style={{ paddingBottom: Math.round(height * CREDIT_BASELINE) }}
        pointerEvents="box-none">
        <LiquidButton title={t('common.enter')} onPress={enter} />
        <Text variant="micro" tone="tertiary" center className="pt-md">
          {t('brand.createdBy')}
        </Text>
      </View>

      {/* Dev-only reset control, outside the layout column so it can't shift it. */}
      <View
        className="absolute inset-x-0 bottom-xs flex-row items-center justify-center"
        pointerEvents="box-none">
        <ResetSession />
      </View>
    </View>
  );
}
