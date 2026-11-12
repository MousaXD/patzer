import { api } from '../api';
import i18n from '../i18n';
import { useAuth, type Profile } from '../state/auth';
import type { Language } from './languages';

// Serialize global language changes so a slower response cannot overwrite
// the user's more recent choice. Account switches invalidate queued writes.
let lastUpdate: Promise<void> = Promise.resolve();

/**
 * Both the global header and command palette save the same user preference.
 * A local-only i18n change is misleading: auth bootstrap restores the saved
 * profile on reload and silently discards that choice.
 */
export function saveInterfaceLanguage(language: Language): Promise<void> {
  const userId = useAuth.getState().user?.id;
  if (userId === undefined) return Promise.reject(new Error('Not signed in'));

  const task = lastUpdate.catch(() => undefined).then(async () => {
    const initial = useAuth.getState().user;
    if (!initial || initial.id !== userId) throw new Error('Account changed');

    if (initial.profile.language !== language) {
      const result = await api.patch<{ profile: Profile }>('/api/settings/profile', { language });
      if (result?.profile?.user_id !== userId || result.profile.language !== language) {
        throw new Error('Invalid saved language response');
      }
      // Do not apply stale account data or overwrite unrelated concurrent
      // profile fields. The server endpoint updates only the requested field.
      const current = useAuth.getState().user;
      if (!current || current.id !== userId) throw new Error('Account changed');
      useAuth.getState().setUser({
        ...current,
        profile: { ...current.profile, language },
      });
    }
    await i18n.changeLanguage(language);
  });
  lastUpdate = task.catch(() => undefined);
  return task;
}
