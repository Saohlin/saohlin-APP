/**
 * Which sentence a journal failure or limit gets. One place, so the same
 * cause reads the same on every screen. Returns dictionary paths, not text.
 */
import type { Dictionary, Path } from '../../i18n';
import type { JournalErrorKind, Limit } from '../api/journal';
import { waitKind } from './format';

type Key = Path<Dictionary>;

/** A failed save. The text is still on the phone, and the sentence says so. */
export function saveFaultCopy(kind: JournalErrorKind): Key {
  switch (kind) {
    case 'offline':
      return 'journal.saveOffline';
    case 'consent':
      return 'journal.consentRequired';
    case 'session':
      return 'chat.errorSession';
    case 'notFound':
      return 'journal.entryGone';
    default:
      return 'journal.saveFailed';
  }
}

/** A failed share, un-share, delete or restore. */
export function actionFaultCopy(kind: JournalErrorKind, fallback: Key = 'journal.actionFailed'): Key {
  switch (kind) {
    case 'offline':
      return 'journal.actionOffline';
    case 'consent':
      return 'journal.consentRequired';
    case 'session':
      return 'chat.errorSession';
    case 'notFound':
      return 'journal.entryMissingTitle';
    default:
      return fallback;
  }
}

/** A limit on writing or searching. Never an error: the wording is calm. */
export function limitCopy(limit: Limit): Key {
  if (limit.code === 'LIMIT_REACHED') return 'journal.full';
  const wait = waitKind(limit.retryAfterSeconds);
  return wait === 'tomorrow' ? 'journal.waitTomorrow' : wait === 'minutes' ? 'journal.waitMinutes' : 'journal.waitMoment';
}

/** What a share that did not happen is called in a route parameter. */
export type ShareNotice = 'PAYWALL' | 'AI_PAUSED' | 'RATE_LIMITED' | 'WAIT' | 'OFFLINE' | 'FAILED';

export function shareNoticeOf(result: Limit | JournalErrorKind): ShareNotice {
  if (typeof result === 'string') return result === 'offline' ? 'OFFLINE' : 'FAILED';
  if (result.code === 'PAYWALL' || result.code === 'AI_PAUSED') return result.code;
  if (result.code === 'RATE_LIMITED') return waitKind(result.retryAfterSeconds) === 'tomorrow' ? 'RATE_LIMITED' : 'WAIT';
  return 'FAILED';
}

export function shareNoticeCopy(n: ShareNotice): Key {
  switch (n) {
    case 'PAYWALL':
      return 'journal.sharePaywall';
    case 'AI_PAUSED':
      return 'journal.shareAiPaused';
    case 'RATE_LIMITED':
      return 'journal.shareLimit';
    case 'WAIT':
      return 'journal.waitMoment';
    case 'OFFLINE':
      return 'journal.actionOffline';
    default:
      return 'journal.shareFailed';
  }
}

const NOTICES: ShareNotice[] = ['PAYWALL', 'AI_PAUSED', 'RATE_LIMITED', 'WAIT', 'OFFLINE', 'FAILED'];
export function isShareNotice(s: unknown): s is ShareNotice {
  return typeof s === 'string' && (NOTICES as string[]).includes(s);
}
