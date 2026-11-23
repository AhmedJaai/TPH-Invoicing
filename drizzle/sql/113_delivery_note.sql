-- سندُ التسليم أو أمرُ التوريد: يُؤرشَف ولا يُقيَّد فاتورةً (أحمد، ٢٤ نوفمبر ٢٠٢٦).
ALTER TYPE document_kind ADD VALUE IF NOT EXISTS 'DELIVERY_NOTE';
