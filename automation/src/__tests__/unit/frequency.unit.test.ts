import { buildFrequency, subtractFrequency } from "../../utils/frequency";

describe("character frequency helpers", () => {
  it("should build a frequency map for a string", () => {
    const freq = buildFrequency("abba");
    console.debug("Frequency entries", Array.from(freq.entries()));
    expect(freq.get("a")).toBe(2);
    expect(freq.get("b")).toBe(2);
    expect(freq.size).toBe(2);
  });

  it("should subtract characters when present", () => {
    const freq = buildFrequency("hello");
    const ok = subtractFrequency(freq, "ole");
    console.debug("Remaining frequency entries", Array.from(freq.entries()));
    expect(ok).toBe(true);
    expect(freq.get("h")).toBe(1);
    expect(freq.get("l")).toBe(1);
    expect(freq.has("o")).toBe(false);
  });

  it("should fail when a character is missing", () => {
    const freq = buildFrequency("abc");
    const ok = subtractFrequency(freq, "abd");
    console.debug("Requested characters", "abd");
    expect(ok).toBe(false);
  });
});
