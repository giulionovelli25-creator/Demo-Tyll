import { describe, expect, it } from "vitest";
import { Translator, type Messages } from "../i18n/translate";
import real from "../i18n/messages.json";
import { ALL_ITEMS, SECTIONS } from "../nav";

const messages: Messages = {
  Stock: ["Bestand", "Scorte", "المخزون"],
  "Coca-Cola cans": ["Coca-Cola Dosen", "Lattine di Coca-Cola", "علب كوكاكولا"],
  "{0} items": ["{0} Artikel", "{0} articoli", "{0} أصناف"],
  "{0} at {1}, {2}": ["{0} in {1}, {2}", "{0} a {1}, {2}", "{0} في {1}، {2}"],
  "Check before concluding.": ["Vor einem Schluss prüfen.", "Verifica prima di concludere.", "تحقق قبل الاستنتاج."],
};
const t = (lang: "de" | "it" | "ar") => new Translator(lang, messages, { items: ["Coca-Cola cans"], names: ["Mercado"] });

describe("translation", () => {
  it("translates whole text, keeping the spaces around it", () => {
    expect(t("de").translate(" Stock ")).toBe(" Bestand ");
  });
  it("lifts out figures, so one template covers every number", () => {
    expect(t("it").translate("63 items")).toBe("63 articoli");
  });
  it("translates items in a sentence and keeps place names", () => {
    // Euro amounts follow the German form: 28,00 €.
    expect(t("de").translate("Coca-Cola cans at Mercado, €28.00")).toBe("Coca-Cola Dosen in Mercado, 28,00 €");
  });
  it("shows dates and times the local way", () => {
    expect(t("de").translate("Tue 13 Oct, 8:33 PM")).toBe("Di 13. Okt., 20:33");
    expect(t("it").translate("13 Oct")).toBe("13 ott");
    expect(t("de").translate("13 Oct.")).toBe("13. Okt.");
    expect(t("ar").translate("13 Oct")).toBe("13 أكتوبر");
    // Arabic reads the 24 hour clock too, kept in reading order, with no English AM or PM.
    expect(t("ar").translate("20 Nov, 9:41 PM")).toBe("20 نوفمبر, \u206621:41\u2069");
    // A 24 hour time is one value: in Arabic it still reads 15:00, never 00:15.
    const clock = new Translator("ar", { "Due today at {0}.": ["", "", "مستحق اليوم الساعة {0}."] }, { items: [], names: [] });
    expect(clock.translate("Due today at 15:00.")).toBe("مستحق اليوم الساعة \u206615:00\u2069.");
    // A time with seconds, as the till records an entry, is one value too.
    const de = new Translator("de", { "At {0}": ["Um {0}", "", ""] }, { items: [], names: [] });
    expect(de.translate("At 9:34:12 PM")).toBe("Um 21:34:12");
    expect(t("ar").translate("3,000 ml")).toBe("\u20663,000 ml\u2069");
  });
  it("translates sentence by sentence", () => {
    expect(t("de").translate("Check before concluding. Check before concluding.")).toBe("Vor einem Schluss prüfen. Vor einem Schluss prüfen.");
  });
  it("translates facts joined by a middle dot one by one", () => {
    expect(t("it").translate("Stock · 63 items")).toBe("Scorte · 63 articoli");
  });
  it("leaves text it does not know in English and notes it", () => {
    const de = t("de");
    expect(de.translate("Nothing like this 4")).toBe("Nothing like this 4");
    expect([...de.missing]).toEqual(["Nothing like this {}"]);
  });
  it("has every sidebar label, short label and section title in every language", () => {
    const words = [...SECTIONS.map((x) => x.title), ...ALL_ITEMS.flatMap((i) => [i.label, i.short ?? i.label])];
    for (const lang of ["de", "it", "ar"] as const) {
      const tr = new Translator(lang, real as unknown as Messages, { items: [], names: [] });
      for (const w of words) tr.translate(w);
      expect([...tr.missing], lang).toEqual([]);
    }
  });
});
