"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CircleAlert } from "lucide-react";
import type { ButtonVariant } from "./ui";
import { ActionButton, toast } from "./ui-client";
import { request } from "@/lib/http-client";

/**
 * زرٌّ يرسل قراراً واحداً ثمّ يحدّث الصفحة — ويقول ما وقع أو لماذا لم يقع.
 *
 * للقرارات الصغيرة التي لا مال فيها (أغلِق تنبيهاً · اسحب اختياراً · أجِّل بنداً):
 * جسمٌ ثابت يُرسَل كما هو، والخادمُ يعيد الاشتقاق. و`undo` جسمُ التراجع إن كان
 * القرارُ يُنقَض بطلبٍ مثله — فيحمله الإشعار.
 */
export function PostAction({
  url,
  body,
  method = "POST",
  undo,
  children,
  variant = "secondary",
  size = "sm",
  done = "حُفظ",
  disabled,
  reason,
  label,
}: {
  url: string;
  body: unknown;
  method?: "POST" | "DELETE";
  undo?: { url?: string; body: unknown; method?: "POST" | "DELETE" };
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  /** عنوانُ الإشعار إن لم يردّ الخادمُ برسالة. */
  done?: string;
  disabled?: boolean;
  reason?: string;
  label?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  function send(u: string, m: "POST" | "DELETE", b: unknown) {
    return request<{ message?: string }>(u, {
      method: m,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    });
  }

  async function run(): Promise<boolean> {
    setError(null);
    const r = await send(url, method, body);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast({
      tone: "ok",
      title: typeof r.data.message === "string" ? r.data.message : done,
      undo: undo
        ? {
            run: async () => {
              const u = await send(undo.url ?? url, undo.method ?? method, undo.body);
              if (u.ok) router.refresh();
              return u.ok;
            },
          }
        : undefined,
    });
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionButton onAction={run} variant={variant} size={size} disabled={disabled} reason={reason} label={label}>
        {children}
      </ActionButton>
      {error && (
        <span role="alert" className="flex basis-full items-start gap-1.5 rounded-lg border border-danger/25 bg-danger-bg px-3 py-2 text-[11px] font-bold text-danger">
          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </span>
      )}
    </>
  );
}
