import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { zh, type MessageKey } from './locales';
export type Language = 'zh-CN' | 'en';
type Values = Record<string, string | number>;
export function translate(
  language: Language,
  key: MessageKey,
  values: Values = {},
): string {
  const template = language === 'zh-CN' ? zh[key] : key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    String(values[name] ?? match),
  );
}
function initialLanguage(): Language {
  const saved = localStorage.getItem('seris.language');
  if (saved === 'zh-CN' || saved === 'en') return saved;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
const I18nContext = createContext<{
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: (key: MessageKey, values?: Values) => string;
} | null>(null);
export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState(initialLanguage);
  const setLanguage = useCallback((next: Language) => {
    localStorage.setItem('seris.language', next);
    updateLanguage(next);
  }, []);
  const t = useCallback(
    (key: MessageKey, values?: Values) => translate(language, key, values),
    [language],
  );
  useLayoutEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  return (
    <I18nContext.Provider
      value={{
        language,
        locale: language === 'en' ? 'en-US' : 'zh-CN',
        setLanguage,
        t,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('I18nProvider missing');
  return context;
}
