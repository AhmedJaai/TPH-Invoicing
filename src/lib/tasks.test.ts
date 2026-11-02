import { describe, expect, it } from "vitest";
import { describeDue, isTaskDue, nextOccurrence, sortTasks, taskLevel, taskProblem, type Task } from "./tasks";

const TODAY = "2026-11-02";
const t = (o: Partial<Task> = {}): Task => ({
  id: "x", title: "مهمّة", note: null, priority: "NORMAL", dueOn: null, remindOn: null, repeat: "NONE", ...o,
});

describe("حال المهمّة", () => {
  it("الموعد الفائت متأخّر، واليوم اليوم", () => {
    expect(taskLevel({ dueOn: "2026-11-01", remindOn: null }, TODAY)).toBe("OVERDUE");
    expect(taskLevel({ dueOn: TODAY, remindOn: null }, TODAY)).toBe("TODAY");
  });
  it("التذكير يحلّ من يومه ولو كان الموعد بعيداً", () => {
    expect(taskLevel({ dueOn: "2026-11-20", remindOn: TODAY }, TODAY)).toBe("REMINDER");
    expect(taskLevel({ dueOn: "2026-11-20", remindOn: "2026-11-03" }, TODAY)).toBe("UPCOMING");
    expect(taskLevel({ dueOn: null, remindOn: "2026-10-30" }, TODAY)).toBe("REMINDER");
  });
  it("بلا موعد ولا تذكير: بلا موعد — ولا تدخل «يحتاج قرارك»", () => {
    const level = taskLevel({ dueOn: null, remindOn: null }, TODAY);
    expect(level).toBe("UNDATED");
    expect(isTaskDue(level)).toBe(false);
  });
  it("المتأخّر يغلب التذكير", () => {
    expect(taskLevel({ dueOn: "2026-10-30", remindOn: "2026-10-20" }, TODAY)).toBe("OVERDUE");
  });
});

describe("الترتيب", () => {
  it("المتأخّر، فاليوم، فالقادم، فبلا موعد؛ والمهمّ قبل العاديّ في اليوم نفسه", () => {
    const list = [
      t({ id: "none" }), t({ id: "later", dueOn: "2026-11-09" }), t({ id: "today", dueOn: TODAY }),
      t({ id: "todayHigh", dueOn: TODAY, priority: "HIGH", title: "ب" }), t({ id: "late", dueOn: "2026-10-25" }),
    ];
    expect(sortTasks(list, TODAY).map((x) => x.id)).toEqual(["late", "todayHigh", "today", "later", "none"]);
  });
});

describe("المكرَّرة", () => {
  it("اليوميّ والأسبوعيّ والشهريّ من الموعد", () => {
    expect(nextOccurrence(t({ dueOn: TODAY, repeat: "DAILY" }), TODAY)?.dueOn).toBe("2026-11-03");
    expect(nextOccurrence(t({ dueOn: TODAY, repeat: "WEEKLY" }), TODAY)?.dueOn).toBe("2026-11-09");
    expect(nextOccurrence(t({ dueOn: TODAY, repeat: "MONTHLY" }), TODAY)?.dueOn).toBe("2026-12-02");
  });
  it("الشهريّ يُقصّ عند آخر الشهر القصير ويعبر السنة", () => {
    expect(nextOccurrence(t({ dueOn: "2027-01-31", repeat: "MONTHLY" }), "2027-01-31")?.dueOn).toBe("2027-02-28");
    expect(nextOccurrence(t({ dueOn: "2026-12-15", repeat: "MONTHLY" }), "2026-12-15")?.dueOn).toBe("2027-01-15");
  });
  it("تأخّر الإنجاز لا يلد تاليةً متأخّرة سلفاً", () => {
    expect(nextOccurrence(t({ dueOn: "2026-10-01", repeat: "WEEKLY" }), TODAY)?.dueOn).toBe("2026-11-05");
  });
  it("التذكير ينتقل بالمسافة نفسها قبل الموعد", () => {
    expect(nextOccurrence(t({ dueOn: TODAY, remindOn: "2026-10-30", repeat: "WEEKLY" }), TODAY))
      .toEqual({ dueOn: "2026-11-09", remindOn: "2026-11-06" });
  });
  it("غير المتكرّرة لا تلد", () => {
    expect(nextOccurrence(t({ dueOn: TODAY }), TODAY)).toBeNull();
  });
});

describe("الفحص", () => {
  it("التذكير لا يتأخّر عن الموعد، والتكرار يحتاج موعداً، و«٣٠ فبراير» يُردّ", () => {
    expect(taskProblem({ dueOn: "2026-11-05", remindOn: "2026-11-06", repeat: "NONE" })).not.toBeNull();
    expect(taskProblem({ dueOn: null, remindOn: null, repeat: "DAILY" })).not.toBeNull();
    expect(taskProblem({ dueOn: "2026-02-30", remindOn: null, repeat: "NONE" })).not.toBeNull();
    expect(taskProblem({ dueOn: "2026-11-05", remindOn: "2026-11-05", repeat: "WEEKLY" })).toBeNull();
    expect(taskProblem({ dueOn: null, remindOn: null, repeat: "NONE" })).toBeNull();
  });
});

describe("الوصف", () => {
  it("بلا أرقامٍ سالبة", () => {
    expect(describeDue(TODAY, TODAY)).toBe("اليوم");
    expect(describeDue("2026-11-03", TODAY)).toBe("غداً");
    expect(describeDue("2026-10-31", TODAY)).toBe("متأخّرة يومين");
  });
});
