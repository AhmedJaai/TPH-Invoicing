import { eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";

/** ما يلزم لعرض ورقة المستند: معرّفُها في الدرايف ونوعُها واسمُها كما قُيِّدت. */
export interface DocumentFileRef {
  driveFileId: string | null;
  mimeType: string;
  fileName: string;
}

export async function documentFileRef(id: string): Promise<DocumentFileRef | null> {
  const [row] = await db
    .select({ driveFileId: documents.driveFileId, mimeType: documents.mimeType, fileName: documents.fileName })
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return row ?? null;
}
