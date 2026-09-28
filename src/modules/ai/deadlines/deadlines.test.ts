import { describe, expect, it } from "vitest";

(globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;

import { assignItems, finalize, isDone, toDay, urgencyOf, type DeadlineItem } from "./scan";
import { digestEmail, dueText, hourInTz, introPrompt, templateIntro } from "./digest";

const TODAY = "2026-09-27";
const draft = (key: string, due: string, extra: Partial<DeadlineItem> & { always?: boolean; assignees?: unknown[] } = {}) => ({
  key, source: "nc-due", sourceLabel: "Nonconformity / CAP due", code: key.toUpperCase(), title: `Item ${key}`, due, link: "/implementation/issues",
  assignees: [] as unknown[], ...extra,
});

describe("deadline scan helpers", () => {
  it("normalises dates and statuses", () => {
    expect(toDay("2026-10-01T10:00:00Z")).toBe("2026-10-01");
    expect(toDay(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01");
    expect(toDay("next week")).toBeNull();
    expect(toDay(null)).toBeNull();
    expect(isDone("Closed")).toBe(true);
    expect(isDone(" cancelled ")).toBe(true);
    expect(isDone("In Progress")).toBe(false);
    expect([-1, 0, 7, 8].map(urgencyOf)).toEqual(["overdue", "today", "week", "later"]);
  });

  it("finalize keeps overdue and horizon items, drops far-future ones unless waiting, dedupes and sorts", () => {
    const items = finalize([
      draft("b", "2026-10-03", { assignees: ["Jane", "", null, "Jane"] }),
      draft("a", "2026-09-20"),
      draft("far", "2026-12-01"),
      draft("wait", "2026-12-01", { always: true }),
      draft("a", "2026-09-20"),
    ], TODAY);
    expect(items.map((i) => i.key)).toEqual(["a", "b", "wait"]);
    expect(items[0]).toMatchObject({ daysLeft: -7, urgency: "overdue" });
    expect(items[1]).toMatchObject({ daysLeft: 6, urgency: "week", assignees: ["Jane"] });
  });

  it("assignItems resolves names/ids/emails and falls back to the audience only when nobody resolves", () => {
    const users = [
      { id: "u1", fullName: "Jane Doe", username: "jane", email: "jane@x.test", actions: ["ms.manage"] },
      { id: "u2", fullName: "Bob Ray", username: "bob", email: "bob@x.test", actions: ["ms.manage"] },
      { id: "u3", fullName: "Cara", username: "cara", email: "cara@x.test", actions: [] },
    ];
    const items = finalize([
      draft("byName", TODAY, { assignees: [" jane doe "] }),
      draft("byId", TODAY, { assignees: ["u2"] }),
      draft("byEmail", TODAY, { assignees: ["CARA@x.test"] }),
      draft("orphan", TODAY, { assignees: ["Someone Gone"], audience: "ms.manage" }),
      draft("nobody", TODAY, { assignees: ["Someone Gone"] }),
    ], TODAY);
    const out = assignItems(items, users);
    expect(out.get("u1")!.map((i) => i.key).sort()).toEqual(["byName", "orphan"]);
    expect(out.get("u2")!.map((i) => i.key).sort()).toEqual(["byId", "orphan"]);
    expect(out.get("u3")!.map((i) => i.key)).toEqual(["byEmail"]);
  });
});

describe("digest content", () => {
  const items = finalize([
    draft("nc-1", "2026-09-25", { title: "Late <CAP>" }),
    draft("doc-1", TODAY, { sourceLabel: "Document review" }),
    draft("tp-1", "2026-10-02"),
  ], TODAY);

  it("template intro counts by urgency and names the first item", () => {
    expect(templateIntro(items)).toBe(
      "You have 3 items needing attention: 1 overdue, 1 due today, 1 due this week. Start with NC-1 (nonconformity / cap due, overdue by 2 days).",
    );
    expect(dueText(items[2])).toBe("due in 5 days (2026-10-02)");
  });

  it("email groups by urgency, links into the app and escapes HTML", () => {
    const mail = digestEmail("Jane", "Intro text.", items, "https://app.test");
    expect(mail.subject).toBe("Your deadlines: 1 overdue, 2 upcoming");
    expect(mail.text).toContain("Overdue\n- Nonconformity / CAP due: NC-1 Late <CAP> — overdue by 2 days\n  https://app.test/implementation/issues");
    expect(mail.html).toContain("Late &lt;CAP&gt;");
    expect(mail.html).not.toContain("<CAP>");
    expect(mail.html.indexOf("Overdue")).toBeLessThan(mail.html.indexOf("Due today"));
  });

  it("AI prompt cites items by code", () => {
    const p = introPrompt(items, TODAY);
    expect(p.user).toContain("[NC-1] Nonconformity / CAP due — Late <CAP> — overdue by 2 days (Overdue)");
    expect(p.system).toMatch(/opening paragraph/);
  });

  it("hourInTz reads the org-local hour and survives an unknown zone", () => {
    const now = new Date("2026-09-27T00:30:00Z");
    expect(hourInTz("Asia/Jakarta", now)).toBe(7);
    expect(hourInTz("UTC", now)).toBe(0);
    expect(hourInTz("Not/AZone", now)).toBe(7);
  });
});
