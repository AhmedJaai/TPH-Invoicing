import { describe, expect, it } from "vitest";
import { fileFingerprint } from "./identity";

describe("fileFingerprint", () => {
  it("الملف نفسه يعطي البصمة نفسها", () => {
    const a = Buffer.from("محتوى كشف");
    expect(fileFingerprint(a)).toBe(fileFingerprint(Buffer.from("محتوى كشف")));
  });

  it("اختلاف بايت واحد يغيّر البصمة", () => {
    expect(fileFingerprint(Buffer.from("أ"))).not.toBe(fileFingerprint(Buffer.from("ب")));
  });
});

describe("بصمةُ الملفّ ليست هويّةَ الحركة", () => {
  it("الكشف نفسه مُصدَّراً بصيغةٍ أخرى بصمتُه مختلفة — وحركاتُه هي هي", () => {
    /*
      ولذلك هي اختصارٌ سريع لا حارس: من اعتمد عليها وحدها دخل عنده
      الكشفُ مرّتين لمجرّد أنّ البنك أعاد تنسيق الملفّ.
    */
    const a = Buffer.from("TRF AL FALAH,3000,01/09");
    const b = Buffer.from("LOCAL TRANSFER AL FALAH;3000;2026-09-01");
    expect(fileFingerprint(a)).not.toBe(fileFingerprint(b));
  });
});
