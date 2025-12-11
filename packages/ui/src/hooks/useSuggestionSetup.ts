import { useEffect } from 'react';
import {
  setThemeSuggestions,
  setProfileSuggestions,
} from '../features/completion';
import { listAvailableProfiles } from '../features/config';
import type { ThemeDefinition } from '../features/theme';

export function useSuggestionSetup(themes: ThemeDefinition[]): void {
  useEffect(() => {
    setThemeSuggestions(
      themes.map((entry) => ({ slug: entry.slug, name: entry.name })),
    );
  }, [themes]);

  useEffect(() => {
    listAvailableProfiles()
      .then((profiles) => setProfileSuggestions(profiles))
      .catch(() => {
        return;
      });
  }, []);
}
