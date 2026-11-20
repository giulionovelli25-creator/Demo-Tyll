// Fictional master data for the demo. Nothing here describes a real business.
import type { Ingredient, MenuItem, Outlet, PriceChange, Property, Staff, Supplier, User } from "../types";
import { DEMO_TIME_ZONE, rel } from "../util";

export const GROUP_NAME = "Lumière Hotels";

export const PROPERTIES: Property[] = [
  { id: "lis", name: "Grand Hotel Lumière", city: "Lisbon", currency: "EUR", rooms: 250, costFactor: 1, timeZone: DEMO_TIME_ZONE },
];

export const SUPPLIERS: Supplier[] = [
  { id: "meat", name: "Carnes Ribeiro & Filhos" },
  { id: "sea", name: "Peixaria Atlântico" },
  { id: "produce", name: "Hortas do Tejo" },
  { id: "dry", name: "Mercearia Lusa" },
  { id: "wine", name: "Douro Cellars" },
  { id: "bev", name: "Fonte Clara Bebidas" },
  { id: "ware", name: "Horeca Ibérica" },
  { id: "hk", name: "Linho Lisboa" },
];

const ing = (
  id: string,
  name: string,
  nameAr: string,
  unit: Ingredient["unit"],
  cost: number,
  supplierId: string,
  shelfLifeDays: number,
  leadDays: number,
  packSize: number,
  priority: boolean,
  dept: Ingredient["dept"] = "food",
): Ingredient => ({ id, name, nameAr, unit, cost, supplierId, shelfLifeDays, leadDays, packSize, priority, dept });

export const INGREDIENTS: Ingredient[] = [
  ing("wagyu", "Wagyu beef mince", "لحم واغيو مفروم", "kg", 43.9, "meat", 4, 1, 5, true),
  ing("tenderloin", "Beef tenderloin", "فيليه بقري", "kg", 63.2, "meat", 5, 1, 5, true),
  ing("lamb", "Lamb rack", "ريش غنم", "kg", 54.1, "meat", 5, 1, 5, true),
  ing("chicken", "Chicken breast", "صدر دجاج", "kg", 14.4, "meat", 4, 1, 10, true),
  ing("turkeybacon", "Smoked bacon", "لحم مقدد", "kg", 20.3, "meat", 10, 1, 2, false),
  ing("salmon", "Salmon fillet", "فيليه سلمون", "kg", 32, "sea", 3, 1, 5, true),
  ing("lobster", "Lobster tail", "كركند", "kg", 85, "sea", 3, 2, 2, true),
  ing("hammour", "Sea bass fillet", "فيليه قاروص", "kg", 30.4, "sea", 3, 1, 5, true),
  ing("saladveg", "Salad vegetables", "خضار السلطة", "kg", 5.41, "produce", 4, 1, 10, false),
  ing("romaine", "Romaine lettuce", "خس روماني", "kg", 6.8, "produce", 4, 1, 5, false),
  ing("potato", "Potatoes", "بطاطس", "kg", 1.86, "produce", 14, 1, 25, false),
  ing("asparagus", "Asparagus", "هليون", "kg", 18.6, "produce", 4, 1, 3, true),
  ing("eggplant", "Eggplant", "باذنجان", "kg", 4.05, "produce", 6, 1, 10, false),
  ing("lemon", "Lemons", "ليمون", "each", 0.5, "produce", 14, 1, 50, false),
  ing("lime", "Limes", "ليمون أخضر", "each", 0.33, "produce", 12, 1, 50, false, "beverage"),
  ing("orange", "Oranges", "برتقال", "kg", 2.4, "produce", 10, 1, 20, true, "beverage"),
  ing("herbs", "Fresh herbs", "أعشاب طازجة", "kg", 37.2, "produce", 4, 1, 1, false),
  ing("berries", "Mixed berries", "توت", "kg", 23.7, "produce", 4, 1, 2, true),
  ing("brioche", "Brioche buns", "خبز بريوش", "each", 1.26, "dry", 3, 1, 48, false),
  ing("bread", "Sliced bread", "خبز توست", "each", 0.25, "dry", 4, 1, 60, false),
  ing("pita", "Pita bread", "خبز عربي", "each", 0.59, "dry", 3, 1, 60, false),
  ing("cheddar", "Cheddar", "جبن شيدر", "kg", 18.6, "dry", 30, 2, 5, false),
  ing("parmesan", "Parmesan", "جبن بارميزان", "kg", 40.5, "dry", 60, 2, 3, true),
  ing("mozzarella", "Mozzarella", "موزاريلا", "kg", 16, "dry", 12, 2, 5, true),
  ing("creamcheese", "Cream cheese", "جبن كريمي", "kg", 12.6, "dry", 21, 2, 5, false),
  ing("labneh", "Labneh", "لبنة", "kg", 10.1, "dry", 14, 2, 5, false),
  ing("butter", "Butter", "زبدة", "kg", 14.4, "dry", 45, 2, 10, false),
  ing("cream", "Cooking cream", "كريمة", "l", 7.1, "dry", 14, 2, 12, false),
  ing("milk", "Milk", "حليب", "l", 1.2, "dry", 7, 1, 12, false, "beverage"),
  ing("eggs", "Eggs", "بيض", "each", 0.47, "dry", 21, 1, 180, false),
  ing("icecream", "Vanilla ice cream", "آيس كريم فانيلا", "kg", 11.8, "dry", 90, 2, 5, false),
  ing("flour", "Flour", "طحين", "kg", 1.53, "dry", 180, 3, 25, false),
  ing("sugar", "Sugar", "سكر", "kg", 1.86, "dry", 365, 3, 25, false),
  ing("arborio", "Arborio rice", "أرز أربوريو", "kg", 5.7, "dry", 365, 3, 10, false),
  ing("linguine", "Linguine", "لينغويني", "kg", 4.39, "dry", 365, 3, 10, false),
  ing("chickpeas", "Chickpeas", "حمص", "kg", 3.72, "dry", 365, 3, 10, false),
  ing("tahini", "Tahini", "طحينة", "kg", 11.8, "dry", 180, 3, 5, false),
  ing("tomatosauce", "Tomato sauce", "صلصة طماطم", "kg", 4.39, "dry", 180, 3, 10, false),
  ing("sauces", "Mayonnaise and sauces", "مايونيز وصلصات", "kg", 9.3, "dry", 90, 3, 5, false),
  ing("stock", "Cooking stock", "مرق", "l", 6.4, "dry", 30, 3, 10, false),
  ing("oil", "Cooking oil", "زيت الطبخ", "l", 4.39, "dry", 365, 3, 20, false),
  ing("oliveoil", "Olive oil", "زيت زيتون", "l", 12.6, "dry", 365, 3, 5, false),
  ing("truffle", "Truffle paste", "معجون الكمأة", "kg", 304.1, "dry", 120, 4, 0.5, true),
  ing("chocolate", "Dark chocolate", "شوكولاتة داكنة", "kg", 23.7, "dry", 365, 3, 5, false),
  ing("coffee", "Coffee beans", "حبوب قهوة", "kg", 40, "bev", 60, 2, 5, true, "beverage"),
  ing("coke", "Coca-Cola cans", "علب كوكاكولا", "each", 1.35, "bev", 180, 2, 24, true, "beverage"),
  ing("soda", "Soda water", "مياه غازية", "l", 2, "bev", 180, 2, 12, false, "beverage"),
  ing("rum", "White rum", "رم أبيض", "l", 42, "wine", 720, 3, 6, true, "beverage"),
  ing("vodka", "Vodka", "فودكا", "l", 45, "wine", 720, 3, 6, true, "beverage"),
  ing("liqueur", "Coffee liqueur", "ليكيور القهوة", "l", 48, "wine", 720, 3, 6, true, "beverage"),
  ing("wine", "House wine", "نبيذ", "l", 27, "wine", 365, 3, 9, true, "beverage"),
  ing("beerkeg", "Draught beer", "بيرة سحب", "l", 7.4, "bev", 60, 2, 30, false, "beverage"),
  ing("water", "Still water bottles", "زجاجات مياه", "each", 1.05, "bev", 365, 2, 24, false, "beverage"),
  ing("sparklingwater", "Sparkling water bottles", "زجاجات مياه فوارة", "each", 1.35, "bev", 365, 2, 24, false, "beverage"),
  ing("wineglass", "Wine glasses", "كؤوس نبيذ", "each", 4.2, "ware", 3650, 5, 24, false, "glassware"),
  ing("highball", "Highball glasses", "كؤوس طويلة", "each", 2.2, "ware", 3650, 5, 24, false, "glassware"),
  ing("plate", "Dinner plates", "أطباق عشاء", "each", 8, "ware", 3650, 5, 12, false, "glassware"),
  // Housekeeping supplies, bought through the same purchasing workflow. Not used by any recipe.
  ing("amenity", "Guest amenity kits", "أطقم ضيافة", "each", 2.8, "hk", 730, 2, 50, false, "supplies"),
  ing("towel", "Bath towels", "مناشف حمام", "each", 7.5, "hk", 3650, 3, 20, false, "supplies"),
  ing("chem", "Cleaning chemicals", "مواد تنظيف", "l", 4.2, "hk", 365, 2, 5, false, "supplies"),
  // More breakable items, so staff can tap the right one when logging a breakage.
  ing("rocks", "Rocks glasses", "كؤوس قصيرة", "each", 2.6, "ware", 3650, 5, 24, false, "glassware"),
  ing("flute", "Champagne flutes", "كؤوس شمبانيا", "each", 3.8, "ware", 3650, 5, 24, false, "glassware"),
  ing("beerglass", "Beer glasses", "كؤوس بيرة", "each", 2.4, "ware", 3650, 5, 24, false, "glassware"),
  ing("waterglass", "Water glasses", "كؤوس ماء", "each", 1.9, "ware", 3650, 5, 24, false, "glassware"),
  ing("sideplate", "Side plates", "أطباق جانبية", "each", 4.6, "ware", 3650, 5, 12, false, "glassware"),
  ing("soupbowl", "Soup bowls", "أوعية حساء", "each", 5.4, "ware", 3650, 5, 12, false, "glassware"),
  ing("coffeecup", "Coffee cups", "فناجين قهوة", "each", 3.4, "ware", 3650, 5, 12, false, "glassware"),
  ing("saucer", "Saucers", "صحون فناجين", "each", 2.1, "ware", 3650, 5, 12, false, "glassware"),
  ing("jug", "Water jugs", "أباريق ماء", "each", 11, "ware", 3650, 5, 6, false, "glassware"),
];

type R = [string, number][];
const item = (
  id: string,
  name: string,
  nameAr: string,
  dept: MenuItem["dept"],
  category: string,
  price: number,
  prepMinutes: number,
  recipe: R | number,
): MenuItem => ({
  id,
  name,
  nameAr,
  dept,
  category,
  price,
  prepMinutes,
  station: dept === "food" ? "kitchen" : "bar",
  ...(typeof recipe === "number"
    ? { standardCost: recipe }
    : { recipe: recipe.map(([ingredientId, qty]) => ({ ingredientId, qty })) }),
});

/** The first 20 items have full recipes. The rest use a standard cost until their recipes are built. */
export const MENU_ITEMS: MenuItem[] = [
  item("burger", "Wagyu beef burger", "برجر واغيو", "food", "Mains", 22, 14, [
    ["wagyu", 0.18], ["brioche", 1], ["cheddar", 0.03], ["saladveg", 0.06], ["potato", 0.18], ["sauces", 0.025], ["oil", 0.03],
  ]),
  item("club", "Club sandwich", "كلوب ساندويتش", "food", "Mains", 18, 11, [
    ["chicken", 0.12], ["turkeybacon", 0.04], ["eggs", 1], ["bread", 3], ["saladveg", 0.06], ["potato", 0.15], ["sauces", 0.02],
  ]),
  item("caesar", "Chicken Caesar salad", "سلطة سيزر", "food", "Starters", 16, 8, [
    ["romaine", 0.15], ["chicken", 0.12], ["parmesan", 0.025], ["sauces", 0.04], ["bread", 1],
  ]),
  item("salmon", "Grilled salmon", "سلمون مشوي", "food", "Mains", 28, 16, [
    ["salmon", 0.18], ["asparagus", 0.08], ["potato", 0.15], ["butter", 0.02], ["lemon", 0.5],
  ]),
  item("tenderloin", "Beef tenderloin", "فيليه بقري", "food", "Mains", 38, 20, [
    ["tenderloin", 0.2], ["potato", 0.15], ["asparagus", 0.08], ["butter", 0.03], ["stock", 0.06],
  ]),
  item("lobster", "Lobster linguine", "لينغويني بالكركند", "food", "Mains", 39, 18, [
    ["lobster", 0.15], ["linguine", 0.12], ["tomatosauce", 0.1], ["cream", 0.05], ["butter", 0.02], ["herbs", 0.005],
  ]),
  item("risotto", "Truffle risotto", "ريزوتو بالكمأة", "food", "Mains", 26, 17, [
    ["arborio", 0.1], ["truffle", 0.012], ["parmesan", 0.03], ["butter", 0.03], ["stock", 0.25], ["cream", 0.03],
  ]),
  item("pizza", "Margherita pizza", "بيتزا مارغريتا", "food", "Mains", 16, 12, [
    ["flour", 0.18], ["mozzarella", 0.12], ["tomatosauce", 0.09], ["herbs", 0.005], ["oliveoil", 0.01],
  ]),
  item("mezze", "Mezze platter", "طبق مزة", "food", "Starters", 17, 9, [
    ["chickpeas", 0.12], ["tahini", 0.03], ["eggplant", 0.15], ["labneh", 0.08], ["pita", 2], ["oliveoil", 0.02],
  ]),
  item("lambchops", "Lamb chops", "ريش غنم", "food", "Mains", 34, 19, [
    ["lamb", 0.28], ["potato", 0.15], ["labneh", 0.04], ["asparagus", 0.06], ["herbs", 0.005],
  ]),
  item("shawarma", "Chicken shawarma plate", "شاورما دجاج", "food", "Mains", 16, 10, [
    ["chicken", 0.18], ["pita", 2], ["tahini", 0.03], ["potato", 0.15], ["saladveg", 0.06],
  ]),
  item("fishchips", "Fish and chips", "سمك وبطاطس", "food", "Mains", 21, 13, [
    ["hammour", 0.18], ["potato", 0.22], ["flour", 0.06], ["oil", 0.08], ["lemon", 0.5],
  ]),
  item("fondant", "Chocolate fondant", "فوندان شوكولاتة", "food", "Desserts", 11, 12, [
    ["chocolate", 0.06], ["butter", 0.04], ["eggs", 2], ["flour", 0.02], ["sugar", 0.03], ["icecream", 0.06],
  ]),
  item("cheesecake", "Berry cheesecake", "تشيز كيك", "food", "Desserts", 10, 5, [
    ["creamcheese", 0.09], ["butter", 0.015], ["berries", 0.04], ["sugar", 0.025], ["cream", 0.03],
  ]),
  item("coke", "Coca-Cola", "كوكاكولا", "beverage", "Soft drinks", 5, 2, [["coke", 1], ["lemon", 0.1]]),
  item("oj", "Fresh orange juice", "عصير برتقال", "beverage", "Soft drinks", 6.5, 4, [["orange", 0.45]]),
  item("cappuccino", "Cappuccino", "كابتشينو", "beverage", "Coffee", 4.5, 4, [["coffee", 0.018], ["milk", 0.18]]),
  item("mojito", "Signature mojito", "موهيتو", "beverage", "Cocktails", 13, 5, [
    ["rum", 0.05], ["lime", 1], ["herbs", 0.008], ["sugar", 0.015], ["soda", 0.1],
  ]),
  item("martini", "Espresso martini", "إسبريسو مارتيني", "beverage", "Cocktails", 14, 5, [
    ["vodka", 0.04], ["liqueur", 0.025], ["coffee", 0.018], ["sugar", 0.01],
  ]),
  item("wine", "House wine, glass", "نبيذ", "beverage", "Wine and beer", 9, 2, [["wine", 0.15]]),
  item("still", "Still water", "مياه", "beverage", "Soft drinks", 4.5, 1, [["water", 1]]),
  item("sparkling", "Sparkling water", "مياه فوارة", "beverage", "Soft drinks", 5, 1, [["sparklingwater", 1]]),
  item("beer", "Draught beer", "بيرة", "beverage", "Wine and beer", 6.5, 2, [["beerkeg", 0.4]]),
  item("fries", "Truffle fries", "بطاطس بالكمأة", "food", "Starters", 8, 7, 2.2),
  item("soup", "Roasted tomato soup", "شوربة طماطم", "food", "Starters", 9, 6, 1.8),
  item("kidspasta", "Kids pasta", "باستا للأطفال", "food", "Mains", 11, 9, 2.1),
  // Breakfast and banquet items. Priced per guest.
  item("breakfast", "Breakfast buffet", "بوفيه الإفطار", "food", "Breakfast", 26, 3, [
    ["eggs", 2], ["bread", 2], ["butter", 0.02], ["turkeybacon", 0.04], ["berries", 0.03], ["orange", 0.35], ["milk", 0.15], ["coffee", 0.012],
  ]),
  item("banqdinner", "Banquet dinner menu", "قائمة عشاء الولائم", "food", "Banquets", 68, 4, [
    ["tenderloin", 0.16], ["salmon", 0.06], ["potato", 0.15], ["asparagus", 0.06], ["romaine", 0.05], ["butter", 0.02], ["chocolate", 0.04], ["cream", 0.04],
  ]),
  item("banqlunch", "Conference lunch buffet", "بوفيه غداء المؤتمرات", "food", "Banquets", 42, 3, [
    ["chicken", 0.16], ["hammour", 0.06], ["linguine", 0.06], ["saladveg", 0.1], ["potato", 0.12], ["bread", 1], ["creamcheese", 0.04],
  ]),
  item("coffeebreak", "Coffee break", "استراحة القهوة", "beverage", "Banquets", 15, 2, [
    ["coffee", 0.015], ["milk", 0.08], ["brioche", 1], ["butter", 0.01], ["orange", 0.2],
  ]),
  item("winepkg", "Banquet wine package", "باقة النبيذ للولائم", "beverage", "Banquets", 24, 2, [["wine", 0.375]]),
  // Bar Azulejo's premium serves (overnight feature 5). They are not in any outlet's menu weights, so the simulated orders
  // are drawn exactly as before; `barMix` in generate.ts adds them to bar bills. Standard cost until recipes are built.
  item("reserve", "Douro reserve red, glass", "نبيذ دورو الأحمر المعتق، كأس", "beverage", "Wine and beer", 16, 2, 4.6),
  item("gintonic", "Gin and tonic", "جين وتونيك", "beverage", "Cocktails", 12, 3, 2.2),
  item("gintonic2", "Gin and tonic, double", "جين وتونيك، مزدوج", "beverage", "Cocktails", 18, 3, 3.9),
];

/** Supplier price changes during the demo period (euros per unit). */
export const INGREDIENT_PRICE_CHANGES: PriceChange[] = [
  { id: "coffee", from: rel(-33), value: 43 },
  { id: "butter", from: rel(-26), value: 15.5 },
  { id: "wagyu", from: rel(-19), value: 48 },
  { id: "salmon", from: rel(-12), value: 35 },
  { id: "hammour", from: rel(-6), value: 33 },
  { id: "mozzarella", from: rel(-5), value: 17.5 },
];

/** Menu price changes during the demo period (euro base price). */
export const MENU_PRICE_CHANGES: PriceChange[] = [
  { id: "mojito", from: rel(-36), value: 14 },
  { id: "salmon", from: rel(-8), value: 29 },
];

const menu = (entries: [string, number][]) => entries.map(([itemId, weight]) => ({ itemId, weight }));

export const OUTLETS: Outlet[] = [
  {
    id: "lis-terrace", propertyId: "lis", name: "Mercado", kind: "All-day dining", code: "MER", priceFactor: 1,
    menu: menu([["breakfast", 30], ["burger", 11], ["club", 7], ["caesar", 6], ["pizza", 6], ["fishchips", 5], ["salmon", 5], ["lobster", 2], ["tenderloin", 3], ["risotto", 3], ["lambchops", 2], ["mezze", 4], ["shawarma", 3], ["fries", 5], ["soup", 3], ["kidspasta", 3], ["fondant", 3], ["cheesecake", 3], ["coke", 10], ["oj", 7], ["cappuccino", 8], ["beer", 4], ["wine", 6], ["mojito", 2], ["still", 7], ["sparkling", 3]]),
    baseOrders: 86, linesPerOrder: 3.4, openMin: 6 * 60 + 30, closeMin: 23 * 60, roomChargeShare: 0.35,
    laborFixed: 1900, laborVariable: 0.09, opexDaily: 820, targetMinutes: 18, reservable: true,
  },
  {
    id: "lis-lobby", propertyId: "lis", name: "Bar Azulejo", kind: "Lobby bar", code: "AZU", priceFactor: 1,
    menu: menu([["wine", 16], ["martini", 8], ["mojito", 8], ["beer", 10], ["cappuccino", 9], ["oj", 4], ["coke", 6], ["still", 7], ["sparkling", 4], ["club", 3], ["mezze", 3], ["fries", 5], ["cheesecake", 2]]),
    sells: ["reserve", "gintonic", "gintonic2"],
    baseOrders: 74, linesPerOrder: 2.8, openMin: 10 * 60, closeMin: 23 * 60 + 59, roomChargeShare: 0.25,
    laborFixed: 780, laborVariable: 0.07, opexDaily: 290, targetMinutes: 10, reservable: false,
  },
  {
    id: "lis-banquets", propertyId: "lis", name: "Banquets and Events", kind: "Banquets and events", code: "BQT", priceFactor: 1,
    menu: menu([["banqlunch", 9], ["banqdinner", 6], ["coffeebreak", 10], ["winepkg", 5], ["still", 4], ["sparkling", 2]]),
    baseOrders: 14, linesPerOrder: 8, openMin: 8 * 60, closeMin: 23 * 60, roomChargeShare: 0.05,
    laborFixed: 1300, laborVariable: 0.08, opexDaily: 560, targetMinutes: 25, reservable: false,
  },
  {
    id: "lis-ird", propertyId: "lis", name: "In-Room Dining", kind: "In-room dining", code: "IRD", priceFactor: 1.15,
    menu: menu([["breakfast", 10], ["burger", 9], ["club", 9], ["caesar", 6], ["pizza", 6], ["salmon", 4], ["shawarma", 3], ["soup", 4], ["kidspasta", 3], ["cheesecake", 4], ["coke", 7], ["oj", 8], ["cappuccino", 7], ["still", 8], ["sparkling", 3], ["wine", 3]]),
    baseOrders: 28, linesPerOrder: 2.6, openMin: 6 * 60, closeMin: 23 * 60 + 59, roomChargeShare: 0.94,
    laborFixed: 620, laborVariable: 0.08, opexDaily: 250, targetMinutes: 35, reservable: false,
  },
];

const FIRST = ["Aisha", "Daniel", "Mei", "Rahul", "Elena", "Tariq", "Grace", "Jonas", "Nadia", "Samuel", "Leila", "Viktor", "Amara", "Hassan", "Sofia", "Kenji", "Farah", "Mateo", "Zainab", "Lucas"];
const LAST = ["Okafor", "Petrov", "Nair", "Santos", "Rahman", "Lindqvist", "Mendoza", "Chaudhry", "Abara", "Novak", "Yilmaz", "Fernando", "Ibrahim", "Castillo", "Mwangi", "Tanaka", "Aziz", "Moreau", "Delgado", "Koroma"];

const ROLE_BY_SLOT: Staff["role"][] = ["server", "server", "server", "server", "bartender", "supervisor", "manager", "chef", "steward"];

function buildStaff(): Staff[] {
  const out: Staff[] = [];
  OUTLETS.forEach((o, oi) => {
    ROLE_BY_SLOT.forEach((role, si) => {
      const n = oi * ROLE_BY_SLOT.length + si;
      out.push({
        id: `${o.code}-S${si + 1}`,
        name: `${FIRST[(n * 7 + 3) % FIRST.length]} ${LAST[(n * 11 + oi) % LAST.length]}`,
        outletId: o.id,
        role,
      });
    });
  });
  // Named people who appear in the guided demo.
  const set = (id: string, name: string) => {
    const s = out.find((x) => x.id === id);
    if (s) s.name = name;
  };
  set("MER-S7", "Sara Haddad");
  set("MER-S9", "Omar Farouk");
  set("AZU-S7", "Karim Nassar");
  return out;
}

export const STAFF: Staff[] = buildStaff();

export const USERS: User[] = [
  { id: "u-owner", name: "Layla Al Mansoori", role: "owner", title: "Owner, Lumière Hotels", propertyIds: "all", outletIds: "all" },
  { id: "u-gm", name: "James Whitfield", role: "gm", title: "General Manager, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: "all" },
  { id: "u-fc", name: "Priya Raman", role: "controller", title: "Financial Controller, Lumière Hotels", propertyIds: "all", outletIds: "all" },
  { id: "u-fnb", name: "Marco Bellini", role: "fnb_director", title: "F&B Director, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: "all" },
  { id: "u-rm", name: "Sara Haddad", role: "restaurant_manager", title: "Restaurant Manager, Mercado", propertyIds: ["lis"], outletIds: ["lis-terrace"], staffId: "MER-S7" },
  { id: "u-lby", name: "Karim Nassar", role: "restaurant_manager", title: "Bar Manager, Bar Azulejo", propertyIds: ["lis"], outletIds: ["lis-lobby"], staffId: "AZU-S7" },
  { id: "u-events", name: "Yasmin Saleh", role: "event_manager", title: "Events Manager, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [] },
  { id: "u-fo", name: "Leila Mansour", role: "front_office", title: "Front Office Manager, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [], deptId: "lis-fo" },
  { id: "u-hk", name: "Grace Mwangi", role: "housekeeping_manager", title: "Executive Housekeeper, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [], deptId: "lis-hk" },
  { id: "u-maid", name: "Maria Santos", role: "employee", title: "Room Attendant, Housekeeping", propertyIds: ["lis"], outletIds: [], staffId: "HK-01", deptId: "lis-hk" },
  { id: "u-con", name: "Lina Haddad", role: "concierge", title: "Concierge, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [], staffId: "CON-01", deptId: "lis-conc" },
  { id: "u-bellcap", name: "Tomas Reyes", role: "bell_captain", title: "Bell Captain, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [], deptId: "lis-bell" },
  { id: "u-bell", name: "Yusuf Adeyemi", role: "employee", title: "Bell Attendant, Bell Team", propertyIds: ["lis"], outletIds: [], staffId: "BELL-01", deptId: "lis-bell" },
  { id: "u-buy", name: "Nadia Rahman", role: "purchasing", title: "Purchasing Manager, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: "all" },
  { id: "u-chef", name: "Rafael Costa", role: "chef", title: "Executive Chef, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: ["lis-terrace"] },
  { id: "u-emp", name: "Omar Farouk", role: "employee", title: "Steward, Mercado", propertyIds: ["lis"], outletIds: ["lis-terrace"], staffId: "MER-S9" },
  { id: "u-cook", name: "Ravi Menon", role: "employee", title: "Commis Chef, Mercado", propertyIds: ["lis"], outletIds: ["lis-terrace"] },
  { id: "u-store", name: "Ahmed Karimi", role: "storekeeper", title: "Storekeeper and Receiving, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [] },
  { id: "u-sales", name: "Noor Al Hashimi", role: "sales", title: "Sales Manager, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [] },
  { id: "u-dos", name: "Daniel Mercer", role: "sales_director", title: "Director of Sales, Grand Hotel Lumière", propertyIds: ["lis"], outletIds: [] },
];

export const ROLE_LABEL: Record<User["role"], string> = {
  owner: "Hotel group owner",
  gm: "General manager",
  controller: "Financial controller",
  fnb_director: "F&B director",
  restaurant_manager: "Restaurant manager",
  event_manager: "Events manager",
  front_office: "Front office",
  housekeeping_manager: "Housekeeping manager",
  concierge: "Concierge",
  bell_captain: "Bell captain",
  purchasing: "Purchasing",
  chef: "Head chef",
  employee: "Operational employee",
  sales: "Sales manager",
  sales_director: "Director of sales",
  storekeeper: "Storekeeper",
};

/**
 * Stock held by one outlet alone, such as a fine-dining kitchen's own cold room. Everything else
 * sits in the hotel's shared store and is drawn on by every outlet that uses it.
 */
export const OUTLET_STORES: { outletId: string; ingredientIds: string[] }[] = [];

/** The outlet that owns an ingredient's stock at a property, or null for the shared store. */
export function storeOwner(propertyId: string, ingredientId: string): string | null {
  for (const s of OUTLET_STORES) if (s.ingredientIds.includes(ingredientId) && s.outletId.startsWith(`${propertyId}-`)) return s.outletId;
  return null;
}

// ---- Lookups ----------------------------------------------------------------
const index = <T extends { id: string }>(arr: T[]) => Object.fromEntries(arr.map((x) => [x.id, x])) as Record<string, T>;
export const propertyById = index(PROPERTIES);
export const outletById = index(OUTLETS);
/** Whether an outlet sells an item: on its menu, or one of the items it sells beyond the weighted menu. */
export const outletSells = (outletId: string, itemId: string) => outletById[outletId].menu.some((m) => m.itemId === itemId) || !!outletById[outletId].sells?.includes(itemId);
export const ingredientById = index(INGREDIENTS);
export const itemById = index(MENU_ITEMS);
export const supplierById = index(SUPPLIERS);
export const staffById = index(STAFF);
export const userById = index(USERS);

export const propertyOfOutlet = (outletId: string) => propertyById[outletById[outletId].propertyId];
export const outletsOfProperty = (propertyId: string) => OUTLETS.filter((o) => o.propertyId === propertyId);
export const outletLabel = (outletId: string) => {
  const o = outletById[outletId];
  return o.name;
};
