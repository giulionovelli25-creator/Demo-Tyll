// Demo translation layer. Screens are written in English; this turns any English text into the chosen language.
// Figures, dates and names are lifted out first, so one template covers every value: "{0} items" serves 4 items and 63 items.
export type Lang = "en" | "de" | "it" | "ar";
export const LANGS: { id: Lang; code: string; name: string }[] = [
  { id: "en", code: "EN", name: "English" },
  { id: "de", code: "DE", name: "Deutsch" },
  { id: "it", code: "IT", name: "Italiano" },
  { id: "ar", code: "AR", name: "العربية" },
];

export type Messages = Record<string, [de: string, it: string, ar: string]>;
const COLUMN = { de: 0, it: 1, ar: 2 } as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTH_NAME = {
  de: ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."],
  it: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  ar: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],
};
const DAY_NAME = {
  de: ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  it: ["lun", "mar", "mer", "gio", "ven", "sab", "dom"],
  ar: ["الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد"],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DATE = `(?:(?:${DAYS.join("|")}) )?\\d{1,2} (?:${MONTHS.join("|")})(?: \\d{4})?\\b`;
const TIME = "\\d{1,2}:\\d{2} (?:AM|PM)\\b";
const FIGURE = "\\d(?:[\\d,.]*\\d)?";
const MONEY = `[−-]?(?:AED|QAR|USD) ?[−-]?${FIGURE}[kKmM]?\\b`;
const CODE = "\\b[A-Z]{2,5}-[A-Za-z0-9-]*\\d[A-Za-z0-9-]*\\b";
const QTY = `[−+-]?${FIGURE} ?(?:kg|ml|g|l)\\b`;
const NUMBER = `[−+-]?${FIGURE}%?`;

export class Translator {
  private readonly token: RegExp;
  private readonly items: Set<string>;
  private readonly cache = new Map<string, string>();
  /** Templates with no translation yet, so gaps can be found by walking the pages. */
  readonly missing = new Set<string>();

  constructor(
    private readonly lang: Exclude<Lang, "en">,
    private readonly messages: Messages,
    /** Items are translated when they appear in a sentence. Places and people keep their names. */
    entities: { items: string[]; names: string[] },
  ) {
    this.items = new Set(entities.items);
    const names = [...entities.items, ...entities.names].sort((a, b) => b.length - a.length).map(esc);
    const named = names.length ? `(?<![\\w-])(?:${names.join("|")})(?![\\w-])` : "(?!)";
    this.token = new RegExp(`${MONEY}|${DATE}|${TIME}|${CODE}|${named}|${QTY}|${NUMBER}`, "g");
  }

  private word(en: string) {
    const row = this.messages[en];
    return row?.[COLUMN[this.lang]] || undefined;
  }

  /** A date, time or item in the chosen language. Figures and names stay as they are. */
  private local(value: string) {
    if (this.items.has(value)) return this.word(value) ?? value;
    const date = new RegExp(`^(?:(${DAYS.join("|")}) )?(\\d{1,2}) (${MONTHS.join("|")})( \\d{4})?$`).exec(value);
    if (date) {
      const day = date[1] ? `${DAY_NAME[this.lang][DAYS.indexOf(date[1])]} ` : "";
      const month = MONTH_NAME[this.lang][MONTHS.indexOf(date[3])];
      return `${day}${date[2]}${this.lang === "de" ? "." : ""} ${month}${date[4] ?? ""}`;
    }
    const time = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(value);
    if (time && this.lang !== "ar") {
      const hour = (Number(time[1]) % 12) + (time[3] === "PM" ? 12 : 0);
      return `${String(hour).padStart(2, "0")}:${time[2]}`;
    }
    // Keeps "3,000 ml" and "8:55 PM" in reading order inside right to left text.
    return this.lang === "ar" && /\d/.test(value) ? `\u2066${value}\u2069` : value;
  }

  private sentence(text: string): string | undefined {
    const exact = this.word(text);
    if (exact) return exact;
    const values: string[] = [];
    const template = text.replace(this.token, (m) => `{${values.push(m) - 1}}`);
    if (!/\p{L}/u.test(template.replace(/\{\d+\}/g, ""))) return template.replace(/\{(\d+)\}/g, (_, i) => this.local(values[Number(i)]));
    const found = this.word(template);
    return found?.replace(/\{(\d+)\}/g, (_, i) => this.local(values[Number(i)]));
  }

  translate(text: string): string {
    const known = this.cache.get(text);
    if (known !== undefined) return known;
    const body = text.trim();
    let out = text;
    if (/[A-Za-z]/.test(body)) {
      const whole = this.sentence(body);
      // A line made of several sentences can be translated one sentence at a time.
      const parts = whole ? [whole] : body.split(/(?<=[.?!:]) /).map((s) => this.sentence(s));
      // German months can end in a full stop just before the sentence does.
      if (parts.every(Boolean)) out = text.replace(body, () => parts.join(" ").replace(/\.\./g, "."));
      else this.missing.add(body.replace(this.token, "{}"));
    }
    this.cache.set(text, out);
    return out;
  }
}
