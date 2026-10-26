export type Appearance = 'light' | 'dark' | 'system';
export const APPEARANCE_KEY = 'lucidity.appearance.v1'; // gitleaks:allow -- public localStorage key

export function parseAppearance(value: string | null): Appearance {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function resolveAppearance(preference: Appearance, systemDark: boolean): 'light' | 'dark' {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function readAppearance(storage: Pick<Storage, 'getItem'>): Appearance {
  try {
    return parseAppearance(storage.getItem(APPEARANCE_KEY));
  } catch {
    return 'system';
  }
}
