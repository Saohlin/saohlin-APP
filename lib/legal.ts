import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

/** The published legal documents on saohlin.com. */
export const LEGAL_URLS = {
  terms: 'https://www.saohlin.com/policies/terms-of-service',
  privacy: 'https://www.saohlin.com/policies/privacy-policy',
} as const;

export type LegalDoc = keyof typeof LEGAL_URLS;

/**
 * Opens a legal document in the in-app browser (SFSafariViewController on iOS,
 * a Custom Tab on Android), so the user stays in the app and returns with Done.
 * Falls back to the system browser if the in-app one can't open.
 */
export async function openLegal(doc: LegalDoc) {
  const url = LEGAL_URLS[doc];
  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      dismissButtonStyle: 'done',
    });
  } catch {
    Linking.openURL(url).catch(() => {});
  }
}
