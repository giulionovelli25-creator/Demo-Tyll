// Keeps the page in the chosen language. It translates text as React renders it, and remembers the English so it can always go back.
import type { Translator } from "./translate";

const ATTRS = ["placeholder", "aria-label", "title"] as const;
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "NOSCRIPT", "KBD"]);
const skip = (el: Element) => SKIP.has(el.tagName) || el.closest("[translate=no]") !== null;

type Seen = { en: string; shown: string };

export function startTranslating(root: Element, t: Translator) {
  const texts = new WeakMap<Text, Seen>();
  const attrs = new WeakMap<Element, Record<string, Seen>>();

  const english = (node: Text) => {
    const seen = texts.get(node);
    // React wrote new text since we last looked, so that is the new English.
    return seen && seen.shown === node.data ? seen.en : node.data;
  };
  const show = (node: Text, en: string, shown: string) => {
    texts.set(node, { en, shown });
    if (node.data !== shown) node.data = shown;
  };

  const element = (el: Element) => {
    if (skip(el)) return;
    // React splits "{n} item{s}" into several text nodes, so adjacent ones are read as one line.
    let run: Text[] = [];
    const flush = () => {
      if (run.length === 0) return;
      const parts = run.map(english);
      const line = t.translate(parts.join(""));
      if (line === parts.join("")) run.forEach((n, i) => show(n, parts[i], parts[i]));
      else run.forEach((n, i) => show(n, parts[i], i === 0 ? line : ""));
      run = [];
    };
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) run.push(child as Text);
      else flush();
    }
    flush();
    for (const name of ATTRS) {
      const value = el.getAttribute(name);
      if (!value) continue;
      const seen = attrs.get(el) ?? {};
      const en = seen[name]?.shown === value ? seen[name].en : value;
      const shown = t.translate(en);
      seen[name] = { en, shown };
      attrs.set(el, seen);
      if (value !== shown) el.setAttribute(name, shown);
    }
  };

  const walk = (top: Element) => {
    element(top);
    top.querySelectorAll("*").forEach(element);
  };

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "childList") {
        if (r.target.nodeType === Node.ELEMENT_NODE) element(r.target as Element);
        r.addedNodes.forEach((n) => { if (n.nodeType === Node.ELEMENT_NODE) walk(n as Element); });
      } else if (r.type === "characterData") {
        if (r.target.parentElement) element(r.target.parentElement);
      } else element(r.target as Element);
    }
  });

  walk(root);
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });

  return () => {
    observer.disconnect();
    const restore = (el: Element) => {
      for (const child of el.childNodes) {
        if (child.nodeType !== Node.TEXT_NODE) continue;
        const seen = texts.get(child as Text);
        if (seen && seen.shown === (child as Text).data) (child as Text).data = seen.en;
      }
      const seen = attrs.get(el);
      if (seen) for (const [name, v] of Object.entries(seen)) if (el.getAttribute(name) === v.shown) el.setAttribute(name, v.en);
    };
    restore(root);
    root.querySelectorAll("*").forEach(restore);
  };
}
