import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./cmsPublic.routes";

describe("renderMarkdown (public CMS renderer)", () => {
  it("never emits author HTML", () => {
    const out = renderMarkdown(`<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>`);
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });

  it("renders the safe markdown subset", () => {
    expect(renderMarkdown("## Title")).toBe("<h2>Title</h2>");
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("**bold** and *em*\nline 2")).toBe("<p><strong>bold</strong> and <em>em</em><br>line 2</p>");
  });

  it("only links http(s)/mailto/relative URLs", () => {
    expect(renderMarkdown("[ok](https://x.io/a?b=1&c=2)")).toBe('<p><a href="https://x.io/a?b=1&amp;c=2" rel="nofollow noopener">ok</a></p>');
    expect(renderMarkdown("[bad](javascript:alert(1))")).not.toContain("href");
    expect(renderMarkdown('[q](/p"onmouseover="x)')).not.toMatch(/href="[^"]*"on/);
  });
});
