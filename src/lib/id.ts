import { randomUUID } from "node:crypto";

/** معرّف فريد للسجلات. UUID v4 من مكتبة العقدة القياسية — بلا اعتمادية خارجية. */
export const createId = (): string => randomUUID();
