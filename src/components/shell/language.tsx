"use client";
import { Languages } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { INGREDIENTS, MENU_ITEMS, OUTLETS, PROPERTIES, STAFF, SUPPLIERS, USERS } from "@/lib/data/catalog";
import { startTranslating } from "@/lib/i18n/dom";
import { LANGS, Translator, type Lang, type Messages } from "@/lib/i18n/translate";

export const useLanguage = create<{ lang: Lang; set(lang: Lang): void }>()(
  persist((set) => ({ lang: "en" as Lang, set: (lang) => set({ lang }) }), { name: "tyll-lang-v1" }),
);

const ready = () => document.documentElement.removeAttribute("data-translating");

/** Follows the chosen language for the whole app: text, reading direction and page language. */
export function LanguageLayer() {
  const lang = useLanguage((s) => s.lang);
  useEffect(() => {
    const html = document.documentElement;
    html.lang = lang;
    html.dir = lang === "ar" ? "rtl" : "ltr";
    if (lang === "en") { ready(); return; }
    let stop: (() => void) | undefined;
    let cancelled = false;
    import("@/lib/i18n/messages.json").then((m) => {
      if (cancelled) return;
      const translator = new Translator(lang, m.default as unknown as Messages, {
        items: [...INGREDIENTS, ...MENU_ITEMS].map((x) => x.name),
        names: [...OUTLETS, ...PROPERTIES, ...SUPPLIERS, ...STAFF, ...USERS].map((x) => x.name),
      });
      (window as unknown as { __tyllMissing?: Set<string> }).__tyllMissing = translator.missing;
      stop = startTranslating(document.body, translator);
      ready();
    }).catch(ready);
    return () => { cancelled = true; stop?.(); };
  }, [lang]);
  return null;
}

/** The language picker in the top bar. Each language is named in its own words. */
export function LanguagePicker() {
  const lang = useLanguage((s) => s.lang);
  const set = useLanguage((s) => s.set);
  return (
    <label translate="no" className="relative flex h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-graphite transition-colors duration-150 ease-tyll focus-within:ring-2 focus-within:ring-accent hover:bg-mist">
      <Languages size={17} aria-hidden />
      <span aria-hidden>{LANGS.find((l) => l.id === lang)?.code}</span>
      <select aria-label="Language" value={lang} onChange={(e) => set(e.target.value as Lang)} className="absolute inset-0 cursor-pointer opacity-0">
        {LANGS.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
}
