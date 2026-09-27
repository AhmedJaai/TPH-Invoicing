/**
 * رسائلُ فحص الطلبات بالعربيّة — تُضبط مرّةً للخادم كلّه.
 *
 * كان ما يُردّ به الطلبُ المعطوب «Invalid input: expected array, received string»
 * يصل إلى صاحب المقهى كما هو. ويُحمَّل من `services/guard.ts` الذي يمرّ به كلُّ مسار.
 */
import { z } from "zod";

z.config(z.locales.ar());
