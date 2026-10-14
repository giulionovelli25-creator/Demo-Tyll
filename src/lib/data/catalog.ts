// Fictional master data for the demo. Nothing here describes a real business.
import type { Ingredient, MenuItem, Outlet, PriceChange, Property, Staff, Supplier, User } from "../types";

export const GROUP_NAME = "Grand Resorts Group";

export const PROPERTIES: Property[] = [
  { id: "dxb", name: "Grand Resort Dubai", city: "Dubai", currency: "AED", rooms: 420, costFactor: 1 },
  { id: "doh", name: "Grand Resort Doha", city: "Doha", currency: "QAR", rooms: 310, costFactor: 1.02 },
];

export const SUPPLIERS: Supplier[] = [
  { id: "meat", name: "Gulf Prime Meats" },
  { id: "sea", name: "Al Bahr Seafood" },
  { id: "produce", name: "Fresh Valley Produce" },
  { id: "bakery", name: "Golden Crust Bakery" },
  { id: "dry", name: "Emirates Dairy & Dry Goods" },
  { id: "bev", name: "Cellar & Co. Beverages" },
  { id: "ware", name: "Horeca Tableware" },
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
  ing("wagyu", "Wagyu beef mince", "لحم واغيو مفروم", "kg", 165, "meat", 4, 1, 5, true),
  ing("tenderloin", "Beef tenderloin", "فيليه بقري", "kg", 305, "meat", 5, 1, 5, true),
  ing("lamb", "Lamb rack", "ريش غنم", "kg", 185, "meat", 5, 1, 5, true),
  ing("chicken", "Chicken breast", "صدر دجاج", "kg", 41, "meat", 4, 1, 10, true),
  ing("turkeybacon", "Turkey bacon", "لحم ديك رومي مقدد", "kg", 90, "meat", 10, 1, 2, false),
  ing("salmon", "Salmon fillet", "فيليه سلمون", "kg", 135, "sea", 3, 1, 5, true),
  ing("lobster", "Lobster tail", "كركند", "kg", 350, "sea", 3, 2, 2, true),
  ing("hammour", "Hammour fillet", "فيليه هامور", "kg", 105, "sea", 3, 1, 5, true),
  ing("saladveg", "Salad vegetables", "خضار السلطة", "kg", 13, "produce", 4, 1, 10, false),
  ing("romaine", "Romaine lettuce", "خس روماني", "kg", 20, "produce", 4, 1, 5, false),
  ing("potato", "Potatoes", "بطاطس", "kg", 9.5, "produce", 14, 1, 25, false),
  ing("asparagus", "Asparagus", "هليون", "kg", 70, "produce", 4, 1, 3, true),
  ing("eggplant", "Eggplant", "باذنجان", "kg", 11.5, "produce", 6, 1, 10, false),
  ing("lemon", "Lemons", "ليمون", "each", 1.75, "produce", 14, 1, 50, false),
  ing("lime", "Limes", "ليمون أخضر", "each", 1.3, "produce", 12, 1, 50, false, "beverage"),
  ing("orange", "Oranges", "برتقال", "kg", 9.5, "produce", 10, 1, 20, true, "beverage"),
  ing("herbs", "Fresh herbs", "أعشاب طازجة", "kg", 87, "produce", 4, 1, 1, false),
  ing("berries", "Mixed berries", "توت", "kg", 125, "produce", 4, 1, 2, true),
  ing("brioche", "Brioche buns", "خبز بريوش", "each", 3.2, "bakery", 3, 1, 48, false),
  ing("bread", "Sliced bread", "خبز توست", "each", 0.85, "bakery", 4, 1, 60, false),
  ing("pita", "Pita bread", "خبز عربي", "each", 1.3, "bakery", 3, 1, 60, false),
  ing("cheddar", "Cheddar", "جبن شيدر", "kg", 84, "dry", 30, 2, 5, false),
  ing("parmesan", "Parmesan", "جبن بارميزان", "kg", 160, "dry", 60, 2, 3, true),
  ing("mozzarella", "Mozzarella", "موزاريلا", "kg", 67, "dry", 12, 2, 5, true),
  ing("creamcheese", "Cream cheese", "جبن كريمي", "kg", 52, "dry", 21, 2, 5, false),
  ing("labneh", "Labneh", "لبنة", "kg", 35, "dry", 14, 2, 5, false),
  ing("butter", "Butter", "زبدة", "kg", 55, "dry", 45, 2, 10, false),
  ing("cream", "Cooking cream", "كريمة", "l", 28, "dry", 14, 2, 12, false),
  ing("milk", "Milk", "حليب", "l", 9, "dry", 7, 1, 12, false, "beverage"),
  ing("eggs", "Eggs", "بيض", "each", 1.25, "dry", 21, 1, 180, false),
  ing("icecream", "Vanilla ice cream", "آيس كريم فانيلا", "kg", 44, "dry", 90, 2, 5, false),
  ing("flour", "Flour", "طحين", "kg", 6.5, "dry", 180, 3, 25, false),
  ing("sugar", "Sugar", "سكر", "kg", 6, "dry", 365, 3, 25, false),
  ing("arborio", "Arborio rice", "أرز أربوريو", "kg", 23, "dry", 365, 3, 10, false),
  ing("linguine", "Linguine", "لينغويني", "kg", 16, "dry", 365, 3, 10, false),
  ing("chickpeas", "Chickpeas", "حمص", "kg", 13, "dry", 365, 3, 10, false),
  ing("tahini", "Tahini", "طحينة", "kg", 46, "dry", 180, 3, 5, false),
  ing("tomatosauce", "Tomato sauce", "صلصة طماطم", "kg", 17.5, "dry", 180, 3, 10, false),
  ing("sauces", "Mayonnaise and sauces", "مايونيز وصلصات", "kg", 35, "dry", 90, 3, 5, false),
  ing("stock", "Stock", "مرق", "l", 26, "dry", 30, 3, 10, false),
  ing("oil", "Cooking oil", "زيت الطبخ", "l", 13, "dry", 365, 3, 20, false),
  ing("oliveoil", "Olive oil", "زيت زيتون", "l", 49, "dry", 365, 3, 5, false),
  ing("truffle", "Truffle paste", "معجون الكمأة", "kg", 1305, "dry", 120, 4, 0.5, true),
  ing("chocolate", "Dark chocolate", "شوكولاتة داكنة", "kg", 99, "dry", 365, 3, 5, false),
  ing("coffee", "Coffee beans", "حبوب قهوة", "kg", 140, "bev", 60, 2, 5, true, "beverage"),
  ing("coke", "Coca-Cola cans", "علب كوكاكولا", "each", 3.5, "bev", 180, 2, 24, true, "beverage"),
  ing("soda", "Soda water", "مياه غازية", "l", 4.35, "bev", 180, 2, 12, false, "beverage"),
  ing("rum", "White rum", "رم أبيض", "l", 125, "bev", 720, 3, 6, true, "beverage"),
  ing("vodka", "Vodka", "فودكا", "l", 115, "bev", 720, 3, 6, true, "beverage"),
  ing("liqueur", "Coffee liqueur", "ليكيور القهوة", "l", 160, "bev", 720, 3, 6, true, "beverage"),
  ing("wine", "House wine", "نبيذ", "l", 99, "bev", 365, 3, 9, true, "beverage"),
  ing("wineglass", "Wine glasses", "كؤوس نبيذ", "each", 18, "ware", 3650, 5, 24, false, "glassware"),
  ing("highball", "Highball glasses", "كؤوس طويلة", "each", 9, "ware", 3650, 5, 24, false, "glassware"),
  ing("plate", "Dinner plates", "أطباق عشاء", "each", 32, "ware", 3650, 5, 12, false, "glassware"),
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
  item("burger", "Wagyu beef burger", "برجر واغيو", "food", "Mains", 98, 14, [
    ["wagyu", 0.18], ["brioche", 1], ["cheddar", 0.03], ["saladveg", 0.06], ["potato", 0.18], ["sauces", 0.025], ["oil", 0.03],
  ]),
  item("club", "Club sandwich", "كلوب ساندويتش", "food", "Mains", 72, 11, [
    ["chicken", 0.12], ["turkeybacon", 0.04], ["eggs", 1], ["bread", 3], ["saladveg", 0.06], ["potato", 0.15], ["sauces", 0.02],
  ]),
  item("caesar", "Chicken Caesar salad", "سلطة سيزر", "food", "Starters", 64, 8, [
    ["romaine", 0.15], ["chicken", 0.12], ["parmesan", 0.025], ["sauces", 0.04], ["bread", 1],
  ]),
  item("salmon", "Grilled salmon", "سلمون مشوي", "food", "Mains", 135, 16, [
    ["salmon", 0.18], ["asparagus", 0.08], ["potato", 0.15], ["butter", 0.02], ["lemon", 0.5],
  ]),
  item("tenderloin", "Beef tenderloin", "فيليه بقري", "food", "Mains", 245, 20, [
    ["tenderloin", 0.2], ["potato", 0.15], ["asparagus", 0.08], ["butter", 0.03], ["stock", 0.06],
  ]),
  item("lobster", "Lobster linguine", "لينغويني بالكركند", "food", "Mains", 185, 18, [
    ["lobster", 0.15], ["linguine", 0.12], ["tomatosauce", 0.1], ["cream", 0.05], ["butter", 0.02], ["herbs", 0.005],
  ]),
  item("risotto", "Truffle risotto", "ريزوتو بالكمأة", "food", "Mains", 120, 17, [
    ["arborio", 0.1], ["truffle", 0.012], ["parmesan", 0.03], ["butter", 0.03], ["stock", 0.25], ["cream", 0.03],
  ]),
  item("pizza", "Margherita pizza", "بيتزا مارغريتا", "food", "Mains", 68, 12, [
    ["flour", 0.18], ["mozzarella", 0.12], ["tomatosauce", 0.09], ["herbs", 0.005], ["oliveoil", 0.01],
  ]),
  item("mezze", "Mezze platter", "طبق مزة", "food", "Starters", 78, 9, [
    ["chickpeas", 0.12], ["tahini", 0.03], ["eggplant", 0.15], ["labneh", 0.08], ["pita", 2], ["oliveoil", 0.02],
  ]),
  item("lambchops", "Lamb chops", "ريش غنم", "food", "Mains", 195, 19, [
    ["lamb", 0.28], ["potato", 0.15], ["labneh", 0.04], ["asparagus", 0.06], ["herbs", 0.005],
  ]),
  item("shawarma", "Chicken shawarma plate", "شاورما دجاج", "food", "Mains", 62, 10, [
    ["chicken", 0.18], ["pita", 2], ["tahini", 0.03], ["potato", 0.15], ["saladveg", 0.06],
  ]),
  item("fishchips", "Fish and chips", "سمك وبطاطس", "food", "Mains", 88, 13, [
    ["hammour", 0.18], ["potato", 0.22], ["flour", 0.06], ["oil", 0.08], ["lemon", 0.5],
  ]),
  item("fondant", "Chocolate fondant", "فوندان شوكولاتة", "food", "Desserts", 48, 12, [
    ["chocolate", 0.06], ["butter", 0.04], ["eggs", 2], ["flour", 0.02], ["sugar", 0.03], ["icecream", 0.06],
  ]),
  item("cheesecake", "Berry cheesecake", "تشيز كيك", "food", "Desserts", 44, 5, [
    ["creamcheese", 0.09], ["butter", 0.015], ["berries", 0.04], ["sugar", 0.025], ["cream", 0.03],
  ]),
  item("coke", "Coca-Cola", "كوكاكولا", "beverage", "Soft drinks", 22, 2, [["coke", 1], ["lemon", 0.1]]),
  item("oj", "Fresh orange juice", "عصير برتقال", "beverage", "Soft drinks", 32, 4, [["orange", 0.45]]),
  item("cappuccino", "Cappuccino", "كابتشينو", "beverage", "Coffee", 28, 4, [["coffee", 0.018], ["milk", 0.18]]),
  item("mojito", "Signature mojito", "موهيتو", "beverage", "Cocktails", 56, 5, [
    ["rum", 0.05], ["lime", 1], ["herbs", 0.008], ["sugar", 0.015], ["soda", 0.1],
  ]),
  item("martini", "Espresso martini", "إسبريسو مارتيني", "beverage", "Cocktails", 65, 5, [
    ["vodka", 0.04], ["liqueur", 0.025], ["coffee", 0.018], ["sugar", 0.01],
  ]),
  item("wine", "House wine, glass", "نبيذ", "beverage", "Wine and beer", 55, 2, [["wine", 0.15]]),
  item("still", "Still water", "مياه", "beverage", "Soft drinks", 26, 1, 4.6),
  item("sparkling", "Sparkling water", "مياه فوارة", "beverage", "Soft drinks", 28, 1, 5.5),
  item("beer", "Draught beer", "بيرة", "beverage", "Wine and beer", 42, 2, 12.5),
  item("fries", "Truffle fries", "بطاطس بالكمأة", "food", "Starters", 38, 7, 9.5),
  item("soup", "Roasted tomato soup", "شوربة طماطم", "food", "Starters", 36, 6, 7.5),
  item("kidspasta", "Kids pasta", "باستا للأطفال", "food", "Mains", 42, 9, 8),
];

/** Supplier price changes during the demo period (AED per unit). */
export const INGREDIENT_PRICE_CHANGES: PriceChange[] = [
  { id: "coffee", from: "2026-09-10", value: 148 },
  { id: "butter", from: "2026-09-17", value: 59 },
  { id: "wagyu", from: "2026-09-24", value: 182 },
  { id: "salmon", from: "2026-10-01", value: 151 },
  { id: "hammour", from: "2026-10-07", value: 122 },
  { id: "mozzarella", from: "2026-10-08", value: 73 },
];

/** Menu price changes during the demo period (AED base price). */
export const MENU_PRICE_CHANGES: PriceChange[] = [
  { id: "mojito", from: "2026-09-07", value: 58 },
  { id: "salmon", from: "2026-10-05", value: 139 },
];

const menu = (entries: [string, number][]) => entries.map(([itemId, weight]) => ({ itemId, weight }));

export const OUTLETS: Outlet[] = [
  {
    id: "dxb-lune", propertyId: "dxb", name: "Maison Lune", kind: "Fine dining restaurant", code: "MLN", priceFactor: 1.1,
    menu: menu([["tenderloin", 9], ["lobster", 7], ["risotto", 6], ["lambchops", 7], ["salmon", 6], ["caesar", 4], ["soup", 4], ["fondant", 6], ["cheesecake", 4], ["wine", 14], ["martini", 5], ["mojito", 3], ["still", 8], ["sparkling", 7], ["cappuccino", 5]]),
    baseOrders: 40, linesPerOrder: 6.2, openMin: 18 * 60, closeMin: 23 * 60 + 30, roomChargeShare: 0.22,
    laborFixed: 6800, laborVariable: 0.1, opexDaily: 3300, targetMinutes: 22, reservable: true,
  },
  {
    id: "dxb-terrace", propertyId: "dxb", name: "The Terrace", kind: "Casual restaurant", code: "TRC", priceFactor: 1,
    menu: menu([["burger", 13], ["club", 8], ["caesar", 7], ["pizza", 8], ["fishchips", 6], ["shawarma", 6], ["mezze", 5], ["salmon", 4], ["fries", 6], ["soup", 3], ["kidspasta", 3], ["fondant", 3], ["cheesecake", 3], ["coke", 12], ["oj", 6], ["cappuccino", 5], ["beer", 6], ["wine", 5], ["mojito", 4], ["still", 7], ["sparkling", 3]]),
    baseOrders: 95, linesPerOrder: 4.4, openMin: 11 * 60 + 30, closeMin: 23 * 60, roomChargeShare: 0.18,
    laborFixed: 5400, laborVariable: 0.09, opexDaily: 2700, targetMinutes: 18, reservable: true,
  },
  {
    id: "dxb-pool", propertyId: "dxb", name: "Azure Pool Bar", kind: "Pool bar", code: "AZR", priceFactor: 1.05,
    menu: menu([["burger", 6], ["club", 6], ["pizza", 5], ["caesar", 4], ["fries", 7], ["coke", 12], ["oj", 8], ["mojito", 12], ["beer", 12], ["wine", 5], ["martini", 4], ["still", 10], ["sparkling", 3]]),
    baseOrders: 80, linesPerOrder: 3.3, openMin: 10 * 60, closeMin: 21 * 60 + 30, roomChargeShare: 0.45,
    laborFixed: 2300, laborVariable: 0.07, opexDaily: 1300, targetMinutes: 12, reservable: false,
  },
  {
    id: "dxb-lobby", propertyId: "dxb", name: "Lobby Lounge", kind: "Lobby lounge", code: "LBY", priceFactor: 1,
    menu: menu([["club", 4], ["caesar", 3], ["mezze", 3], ["cheesecake", 6], ["fondant", 3], ["cappuccino", 16], ["oj", 7], ["coke", 5], ["wine", 6], ["martini", 5], ["still", 7], ["sparkling", 4]]),
    baseOrders: 70, linesPerOrder: 2.7, openMin: 7 * 60, closeMin: 23 * 60 + 30, roomChargeShare: 0.25,
    laborFixed: 1900, laborVariable: 0.07, opexDaily: 950, targetMinutes: 10, reservable: false,
  },
  {
    id: "dxb-ird", propertyId: "dxb", name: "Room Service", kind: "In-room dining", code: "IRD", priceFactor: 1.15,
    menu: menu([["burger", 9], ["club", 9], ["caesar", 6], ["pizza", 6], ["salmon", 4], ["shawarma", 4], ["soup", 4], ["kidspasta", 4], ["cheesecake", 4], ["coke", 8], ["oj", 8], ["cappuccino", 7], ["still", 9], ["sparkling", 3]]),
    baseOrders: 40, linesPerOrder: 3.2, openMin: 6 * 60, closeMin: 23 * 60 + 59, roomChargeShare: 0.94,
    laborFixed: 2500, laborVariable: 0.08, opexDaily: 1000, targetMinutes: 35, reservable: false,
  },
  {
    id: "doh-dana", propertyId: "doh", name: "Al Dana", kind: "Signature restaurant", code: "DNA", priceFactor: 1.1,
    menu: menu([["tenderloin", 8], ["lambchops", 9], ["lobster", 6], ["salmon", 6], ["risotto", 5], ["mezze", 7], ["soup", 4], ["fondant", 5], ["cheesecake", 3], ["wine", 9], ["mojito", 3], ["still", 9], ["sparkling", 6], ["cappuccino", 5], ["oj", 4]]),
    baseOrders: 34, linesPerOrder: 6, openMin: 18 * 60, closeMin: 23 * 60 + 30, roomChargeShare: 0.2,
    laborFixed: 5600, laborVariable: 0.1, opexDaily: 2700, targetMinutes: 22, reservable: true,
  },
  {
    id: "doh-souq", propertyId: "doh", name: "Souq Kitchen", kind: "All-day dining", code: "SQK", priceFactor: 1,
    menu: menu([["burger", 9], ["club", 8], ["caesar", 7], ["pizza", 7], ["shawarma", 9], ["mezze", 8], ["fishchips", 5], ["fries", 5], ["soup", 4], ["kidspasta", 4], ["fondant", 3], ["cheesecake", 4], ["coke", 10], ["oj", 9], ["cappuccino", 8], ["still", 8], ["sparkling", 3]]),
    baseOrders: 85, linesPerOrder: 4.3, openMin: 6 * 60 + 30, closeMin: 23 * 60, roomChargeShare: 0.3,
    laborFixed: 4700, laborVariable: 0.09, opexDaily: 2300, targetMinutes: 18, reservable: true,
  },
  {
    id: "doh-sky", propertyId: "doh", name: "Skyline", kind: "Rooftop bar", code: "SKY", priceFactor: 1.1,
    menu: menu([["mojito", 12], ["martini", 10], ["wine", 10], ["beer", 9], ["burger", 4], ["pizza", 4], ["fries", 7], ["mezze", 5], ["coke", 5], ["still", 6], ["sparkling", 4]]),
    baseOrders: 60, linesPerOrder: 3.4, openMin: 17 * 60, closeMin: 23 * 60 + 59, roomChargeShare: 0.15,
    laborFixed: 2200, laborVariable: 0.07, opexDaily: 1500, targetMinutes: 10, reservable: false,
  },
  {
    id: "doh-ird", propertyId: "doh", name: "Room Service", kind: "In-room dining", code: "IRQ", priceFactor: 1.15,
    menu: menu([["burger", 8], ["club", 9], ["caesar", 6], ["pizza", 5], ["shawarma", 6], ["soup", 4], ["kidspasta", 3], ["cheesecake", 4], ["coke", 7], ["oj", 8], ["cappuccino", 7], ["still", 9]]),
    baseOrders: 30, linesPerOrder: 3.1, openMin: 6 * 60, closeMin: 23 * 60 + 59, roomChargeShare: 0.95,
    laborFixed: 1900, laborVariable: 0.08, opexDaily: 780, targetMinutes: 35, reservable: false,
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
  set("TRC-S7", "Sara Haddad");
  set("TRC-S9", "Omar Farouk");
  return out;
}

export const STAFF: Staff[] = buildStaff();

export const USERS: User[] = [
  { id: "u-owner", name: "Layla Al Mansoori", role: "owner", title: "Owner, Grand Resorts Group", propertyIds: "all", outletIds: "all" },
  { id: "u-gm", name: "James Whitfield", role: "gm", title: "General Manager, Grand Resort Dubai", propertyIds: ["dxb"], outletIds: "all" },
  { id: "u-fc", name: "Priya Raman", role: "controller", title: "Group Financial Controller", propertyIds: "all", outletIds: "all" },
  { id: "u-fnb", name: "Marco Bellini", role: "fnb_director", title: "F&B Director, Grand Resort Dubai", propertyIds: ["dxb"], outletIds: "all" },
  { id: "u-rm", name: "Sara Haddad", role: "restaurant_manager", title: "Restaurant Manager, The Terrace", propertyIds: ["dxb"], outletIds: ["dxb-terrace"], staffId: "TRC-S7" },
  { id: "u-buy", name: "Nadia Rahman", role: "purchasing", title: "Purchasing Manager, Grand Resort Dubai", propertyIds: ["dxb"], outletIds: "all" },
  { id: "u-chef", name: "Rafael Costa", role: "chef", title: "Head Chef, The Terrace", propertyIds: ["dxb"], outletIds: ["dxb-terrace"] },
  { id: "u-emp", name: "Omar Farouk", role: "employee", title: "Steward, The Terrace", propertyIds: ["dxb"], outletIds: ["dxb-terrace"], staffId: "TRC-S9" },
];

export const ROLE_LABEL: Record<User["role"], string> = {
  owner: "Hotel group owner",
  gm: "General manager",
  controller: "Financial controller",
  fnb_director: "F&B director",
  restaurant_manager: "Restaurant manager",
  purchasing: "Purchasing",
  chef: "Head chef",
  employee: "Operational employee",
};

/**
 * Stock held by one outlet alone, such as a fine-dining kitchen's own cold room. Everything else
 * sits in the hotel's shared store and is drawn on by every outlet that uses it.
 */
export const OUTLET_STORES: { outletId: string; ingredientIds: string[] }[] = [
  { outletId: "dxb-lune", ingredientIds: ["lobster", "truffle", "tenderloin"] },
  { outletId: "doh-dana", ingredientIds: ["lobster", "truffle"] },
];

/** The outlet that owns an ingredient's stock at a property, or null for the shared store. */
export function storeOwner(propertyId: string, ingredientId: string): string | null {
  for (const s of OUTLET_STORES) if (s.ingredientIds.includes(ingredientId) && s.outletId.startsWith(`${propertyId}-`)) return s.outletId;
  return null;
}

// ---- Lookups ----------------------------------------------------------------
const index = <T extends { id: string }>(arr: T[]) => Object.fromEntries(arr.map((x) => [x.id, x])) as Record<string, T>;
export const propertyById = index(PROPERTIES);
export const outletById = index(OUTLETS);
export const ingredientById = index(INGREDIENTS);
export const itemById = index(MENU_ITEMS);
export const supplierById = index(SUPPLIERS);
export const staffById = index(STAFF);
export const userById = index(USERS);

export const propertyOfOutlet = (outletId: string) => propertyById[outletById[outletId].propertyId];
export const outletsOfProperty = (propertyId: string) => OUTLETS.filter((o) => o.propertyId === propertyId);
export const outletLabel = (outletId: string) => {
  const o = outletById[outletId];
  return o.kind === "In-room dining" ? `${o.name}, ${propertyById[o.propertyId].city}` : o.name;
};
