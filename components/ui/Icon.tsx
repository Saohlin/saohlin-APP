import {
  ArrowRight,
  ArrowsClockwise,
  ArrowsInSimple,
  ArrowsOutSimple,
  BookmarkSimple,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Check,
  Clock,
  Copy,
  DotsThree,
  DownloadSimple,
  Envelope,
  Eye,
  EyeSlash,
  Gear,
  Gift,
  Heart,
  Info,
  Layout,
  List,
  LockSimple,
  MagnifyingGlass,
  Microphone,
  NotePencil,
  PencilSimple,
  Plus,
  ShieldCheck,
  SpeakerHigh,
  Star,
  Trash,
  User,
  WarningCircle,
  WifiSlash,
  X,
  type Icon as PhosphorIcon,
} from 'phosphor-react-native';
import type { ColorValue } from 'react-native';

import { useTheme } from '../../theme';

/**
 * Single wrapper over the icon set (Phosphor, `light` weight by default).
 * To switch to custom SVGs later, keep the `name` union and swap the implementation.
 */
export type IconName =
  | 'chat' | 'cards' | 'journal' | 'profile' | 'menu' | 'settings' | 'mail'
  | 'mic' | 'send' | 'speaker' | 'copy' | 'lock' | 'bookmark' | 'search'
  | 'calendar' | 'eye' | 'eye-off' | 'gift' | 'heart' | 'shield' | 'back'
  | 'forward' | 'close' | 'check' | 'chevron-down' | 'chevron-right'
  | 'alert' | 'info' | 'refresh' | 'wifi-off' | 'plus' | 'trash' | 'edit'
  | 'download' | 'star' | 'clock' | 'more' | 'expand' | 'collapse';

const MAP: Record<IconName, PhosphorIcon> = {
  chat: ChatCircle,
  // Panel-with-column glyph for the cards entry in the drawer.
  cards: Layout,
  journal: NotePencil,
  profile: User,
  menu: List,
  settings: Gear,
  mail: Envelope,
  mic: Microphone,
  send: ArrowRight,
  speaker: SpeakerHigh,
  copy: Copy,
  lock: LockSimple,
  bookmark: BookmarkSimple,
  search: MagnifyingGlass,
  calendar: CalendarBlank,
  eye: Eye,
  'eye-off': EyeSlash,
  gift: Gift,
  heart: Heart,
  shield: ShieldCheck,
  back: CaretLeft,
  forward: CaretRight,
  close: X,
  check: Check,
  'chevron-down': CaretDown,
  'chevron-right': CaretRight,
  alert: WarningCircle,
  info: Info,
  refresh: ArrowsClockwise,
  'wifi-off': WifiSlash,
  plus: Plus,
  trash: Trash,
  edit: PencilSimple,
  download: DownloadSimple,
  star: Star,
  clock: Clock,
  more: DotsThree,
  // Expand/collapse pair for the composer.
  expand: ArrowsOutSimple,
  collapse: ArrowsInSimple,
};

export type IconProps = {
  name: IconName;
  size?: number;
  /** Any colour value. Defaults to secondary text. Tabs pass a ColorValue. */
  color?: ColorValue;
  /** `light` by default; use `regular` at 12 px and below, where light breaks up. */
  weight?: 'thin' | 'light' | 'regular' | 'bold';
  /** Fills the glyph — for a selected bookmark or a favourited card. */
  filled?: boolean;
};

export function Icon({ name, size = 20, color, weight = 'light', filled }: IconProps) {
  const { colors } = useTheme();
  const Glyph = MAP[name];
  return (
    <Glyph
      size={size}
      color={(color ?? colors.textSecondary) as string}
      weight={filled ? 'fill' : weight}
    />
  );
}
