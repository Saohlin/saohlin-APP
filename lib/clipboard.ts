import * as Clipboard from 'expo-clipboard';

/** Copies a reply. Resolves false if the platform refused. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
