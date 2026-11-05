import { describe, expect, it } from "vitest";
import { Translator, type Messages } from "../i18n/translate";

const messages: Messages = {
  Stock: ["Bestand", "Scorte", "المخزون"],
  "Coca-Cola cans": ["Coca-Cola Dosen", "Lattine di Coca-Cola", "علب كوكاكولا"],
  "{0} items": ["{0} Artikel", "{0} articoli", "{0} أصناف"],
  "{0} at {1}, {2}": ["{0} in {1}, {2}", "{0} a {1}, {2}", "{0} في {1}، {2}"],
  "Check before concluding.": ["Vor einem Schluss prüfen.", "Verifica prima di concludere.", "تحقق قبل الاستنتاج."],
};
const t = (lang: "de" | "it" | "ar") => new Translator(lang, messages, { items: ["Coca-Cola cans"], names: ["The Terrace"] });

describe("translation", () => {
  it("translates whole text, keeping the spaces around it", () => {
    expect(t("de").translate(" Stock ")).toBe(" Bestand ");
  });
  it("lifts out figures, so one template covers every number", () => {
    expect(t("it").translate("63 items")).toBe("63 articoli");
  });
  it("translates items in a sentence and keeps place names", () => {
    expect(t("de").translate("Coca-Cola cans at The Terrace, AED 28.00")).toBe("Coca-Cola Dosen in The Terrace, AED 28.00");
  });
  it("shows dates and times the local way", () => {
    expect(t("de").translate("Tue 13 Oct, 8:33 PM")).toBe("Di 13. Okt., 20:33");
    expect(t("it").translate("13 Oct")).toBe("13 ott");
    expect(t("de").translate("13 Oct.")).toBe("13. Okt.");
    expect(t("ar").translate("13 Oct")).toBe("13 أكتوبر");
    expect(t("ar").translate("3,000 ml")).toBe("\u20663,000 ml\u2069");
  });
  it("translates sentence by sentence", () => {
    expect(t("de").translate("Check before concluding. Check before concluding.")).toBe("Vor einem Schluss prüfen. Vor einem Schluss prüfen.");
  });
  it("leaves text it does not know in English and notes it", () => {
    const de = t("de");
    expect(de.translate("Nothing like this 4")).toBe("Nothing like this 4");
    expect([...de.missing]).toEqual(["Nothing like this {}"]);
  });
});
