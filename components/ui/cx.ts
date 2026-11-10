/** Join class names, dropping falsy entries. Later strings win in NativeWind. */
export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(' ');
