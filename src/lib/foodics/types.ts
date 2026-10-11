/**
 * ما نقرؤه من واجهة فودكس — **وما لا نقرؤه لا يدخل**.
 *
 * المخطّطاتُ هنا تُسقِط كلَّ حقلٍ لم يُسمَّ: الطلبُ يحمل اسمَ العميل ورقمَه
 * وعنوانَه، ولا حاجةَ لنا بها ولا تُخزَّن. فالحذفُ عند الباب لا بعده.
 *
 * والأرقامُ كما فُحصت على حساب المقهى (١١ أكتوبر ٢٠٢٦) لا كما تقول الوثائق:
 * المبالغُ **ريالاتٌ بكسور** (`16.52174`) لا هللات، والمرتجَعُ **طلبٌ مستقلّ**
 * بحال ٥ ومرجعٍ خاصّ وكمّيّةٍ موجبة، والخيارُ داخل منتجه لا صفٌّ بجانبه.
 */
import { z } from "zod";

/** حالُ الطلب. */
export const ORDER_STATUS = { PENDING: 1, ACTIVE: 2, DECLINED: 3, CLOSED: 4, RETURNED: 5, JOINED: 6, VOID: 7 } as const;
/** حالُ البند داخل الطلب. */
export const PRODUCT_STATUS = { PENDING: 1, ACTIVE: 2, CLOSED: 3, MOVED: 4, VOID: 5, RETURNED: 6, DECLINED: 7 } as const;
/** نوعُ طريقة الدفع — النوعُ هويّة، والاسمُ يكتبه صاحبُ الحساب. */
export const PAYMENT_TYPE = { CASH: 1, CARD: 2, OTHER: 3, GIFT_CARD: 4, HOUSE_ACCOUNT: 5, THIRD_PARTY: 7 } as const;
/** نوعُ حركة المخزون — ما يعنينا منها الشراءُ ومرتجَعُه. */
export const INVENTORY_TX = { PURCHASING: 1, RETURN_TO_SUPPLIER: 4 } as const;
/** حركةٌ مُرحَّلة — وغيرُها مسوّدةٌ قد تتغيّر. */
export const INVENTORY_TX_POSTED = 4;

const amount = z.number().nullable().optional();

const Tax = z.object({ pivot: z.object({ amount: amount }) });

const Option = z.object({
  id: z.string(),
  quantity: z.number(),
  unit_price: amount,
  total_price: amount,
  /** الواجهةُ لا تُرجع ضريبةَ الخيار صفّاً — تُشتقّ من الفرق بين شامله وما قبل ضريبته. */
  tax_exclusive_total_price: amount,
  modifier_option: z.object({ sku: z.string().nullable().optional(), name: z.string().nullable().optional() }).nullable().optional(),
});

const OrderProduct = z.object({
  id: z.string(),
  quantity: z.number(),
  unit_price: amount,
  total_price: amount,
  discount_amount: amount,
  total_cost: amount,
  status: z.number(),
  taxes: z.array(Tax).optional(),
  options: z.array(Option).optional(),
  product: z.object({
    sku: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    name_localized: z.string().nullable().optional(),
    category: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  }).nullable().optional(),
});

const Payment = z.object({
  id: z.string(),
  amount: z.number(),
  tips: amount,
  business_date: z.string().nullable().optional(),
  added_at: z.string().nullable().optional(),
  payment_method: z.object({ name: z.string(), type: z.number() }).nullable().optional(),
});

export const FoodicsOrder = z.object({
  id: z.string(),
  reference: z.number(),
  business_date: z.string(),
  status: z.number(),
  type: z.number(),
  source: z.number(),
  subtotal_price: amount,
  discount_amount: amount,
  total_price: amount,
  opened_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  branch: z.object({ name: z.string().nullable().optional(), reference: z.string().nullable().optional() }).nullable().optional(),
  original_order: z.object({ reference: z.number().nullable().optional() }).nullable().optional(),
  products: z.array(OrderProduct).optional(),
  payments: z.array(Payment).optional(),
  combos: z.array(z.unknown()).optional(),
});
export type FoodicsOrder = z.infer<typeof FoodicsOrder>;

export const FoodicsSupplier = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
});
export type FoodicsSupplier = z.infer<typeof FoodicsSupplier>;

export const FoodicsInventoryTx = z.object({
  id: z.string(),
  reference: z.string(),
  type: z.number(),
  status: z.number(),
  business_date: z.string(),
  paid_tax: amount,
  additional_cost: amount,
  notes: z.string().nullable().optional(),
  invoice_number: z.string().nullable().optional(),
  invoice_date: z.string().nullable().optional(),
  posted_at: z.string().nullable().optional(),
  updated_at: z.string(),
  supplier: z.object({ id: z.string(), name: z.string() }).nullable().optional(),
  items: z.array(z.object({
    id: z.string(),
    name: z.string(),
    sku: z.string().nullable().optional(),
    storage_unit: z.string().nullable().optional(),
    pivot: z.object({ quantity: z.number(), cost: amount }),
  })).optional(),
});
export type FoodicsInventoryTx = z.infer<typeof FoodicsInventoryTx>;

export const FoodicsTill = z.object({
  id: z.string(),
  business_date: z.string(),
  opening_amount: amount,
  closing_amount: amount,
  estimated_cash: amount,
  variance: amount,
  opened_at: z.string().nullable().optional(),
  closed_at: z.string().nullable().optional(),
  /* الاسمُ وحده: كائنُ المستخدم يحمل بريدَه وبصمةَ رمزه، ولا يدخل منهما شيء */
  user: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  device: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
});
export type FoodicsTill = z.infer<typeof FoodicsTill>;

/** حركاتُ الصرف التي يكتبها فودكس وحده مع كلّ طلب. */
export const STOCK_MOVE = { CONSUMPTION: 8, RETURN: 9, WASTE: 10 } as const;
export const STOCK_MOVE_KINDS: readonly number[] = [STOCK_MOVE.CONSUMPTION, STOCK_MOVE.RETURN, STOCK_MOVE.WASTE];

const StockItem = {
  id: z.string(),
  name: z.string(),
  sku: z.string().nullable().optional(),
  storage_unit: z.string().nullable().optional(),
  ingredient_unit: z.string().nullable().optional(),
  storage_to_ingredient_factor: z.number().nullable().optional(),
};

/** حركةُ صرفٍ ببنودها — الكمّيّةُ بوحدة التخزين، والكلفةُ كلفةُ فودكس للسطر. */
export const FoodicsStockMove = z.object({
  id: z.string(),
  type: z.number(),
  status: z.number(),
  business_date: z.string(),
  items: z.array(z.object({ ...StockItem, pivot: z.object({ quantity: z.number(), cost: amount }) })).optional(),
});
export type FoodicsStockMove = z.infer<typeof FoodicsStockMove>;

/** جردٌ كتبه من عدّ الرفّ. `variance_*` حسابُ فودكس، والمعدودُ `quantity`. */
export const FoodicsStockCount = z.object({
  id: z.string(),
  reference: z.string(),
  business_date: z.string(),
  status: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  creator: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  items: z.array(z.object({
    ...StockItem,
    pivot: z.object({ quantity: z.number(), variance_quantity: amount, variance_cost: amount }),
  })).optional(),
});
export type FoodicsStockCount = z.infer<typeof FoodicsStockCount>;

/** صنفُ مخزونٍ في كتالوج فودكس. المحذوفُ يحمل `deleted_at`. */
export const FoodicsInventoryItem = z.object({
  sku: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  storage_unit: z.string().nullable().optional(),
  ingredient_unit: z.string().nullable().optional(),
  storage_to_ingredient_factor: z.number().nullable().optional(),
  cost: amount,
  deleted_at: z.string().nullable().optional(),
});
export type FoodicsInventoryItem = z.infer<typeof FoodicsInventoryItem>;

/** صنفٌ يُباع ومكوّناتُ وصفته — كمّيّةُ المكوّن بوحدة صرفه. */
export const FoodicsCatalogProduct = z.object({
  sku: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  price: amount,
  cost: amount,
  is_active: z.boolean().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  ingredients: z.array(z.object({
    sku: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    ingredient_unit: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
    pivot: z.object({ quantity: z.number().nullable().optional() }),
  })).optional(),
});
export type FoodicsCatalogProduct = z.infer<typeof FoodicsCatalogProduct>;
