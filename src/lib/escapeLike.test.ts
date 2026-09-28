import { describe, it, expect } from "vitest";
import { escapeLike } from "./escapeLike";

describe("escapeLike", () => {
  it("escapes LIKE wildcards and the escape char itself", () => {
    expect(escapeLike("50%_off\\now")).toBe("50\\%\\_off\\\\now");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeLike("Acme Corp")).toBe("Acme Corp");
  });
});
