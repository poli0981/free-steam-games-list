import { describe, expect, it } from "vitest";
import { formatNumber, parseIntSafe, parseReleaseDate, parseReviewPercent, reviewLabel } from "./utils";

/**
 * The dataset's numbers are formatted strings ("492,197", "N/A"), and these
 * read them. Outside a browser there is no <html lang>, so the locale is "en".
 */
describe("formatNumber", () => {
  it("groups a number, or a string the dataset already grouped", () => {
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber("492,197")).toBe("492,197");
  });

  it("shows a dash for nothing, and what is not a number as it came", () => {
    for (const value of [null, undefined, "", "N/A"]) expect(formatNumber(value)).toBe("—");
    expect(formatNumber("Coming soon")).toBe("Coming soon");
  });
});

describe("parseIntSafe", () => {
  it("reads a grouped string, and passes a number through", () => {
    expect(parseIntSafe("492,197")).toBe(492197);
    expect(parseIntSafe(" 12 ")).toBe(12);
    expect(parseIntSafe(7)).toBe(7);
  });

  it("is 0 for what is not a number", () => {
    expect(parseIntSafe("N/A")).toBe(0);
    expect(parseIntSafe(undefined)).toBe(0);
  });
});

describe("parseReleaseDate", () => {
  it("orders the dates Steam writes", () => {
    expect(parseReleaseDate("Aug 21, 2012")).toBe(new Date(2012, 7, 21).getTime());
    expect(parseReleaseDate(" 2025 ")).toBe(Date.UTC(2025, 0, 1));
  });

  it("sends what is not a date to the far end", () => {
    for (const value of ["Coming soon", "Q1 2026", "  ", "", null, undefined]) {
      expect(parseReleaseDate(value)).toBe(-Infinity);
    }
  });
});

/**
 * The review summary as the dataset stores it: "86% (Very Positive)",
 * "100% (3 user reviews)" or "No reviews". Written against the regexes these
 * used before they were bounded (SonarCloud typescript:S8786).
 */
describe("parseReviewPercent", () => {
  it("reads the percentage the summary starts with", () => {
    expect(parseReviewPercent("86% (Very Positive)")).toBe(86);
    expect(parseReviewPercent("100% (3 user reviews)")).toBe(100);
    expect(parseReviewPercent("0% (Overwhelmingly Negative)")).toBe(0);
    expect(parseReviewPercent("7 % (Mostly Negative)")).toBe(7);
    expect(parseReviewPercent("Mostly Positive (72%)")).toBe(72);
  });

  it("has none for a missing summary", () => {
    expect(parseReviewPercent("No reviews")).toBeNull();
    expect(parseReviewPercent("N/A")).toBeNull();
    expect(parseReviewPercent("")).toBeNull();
    expect(parseReviewPercent(null)).toBeNull();
    expect(parseReviewPercent(undefined)).toBeNull();
  });
});

describe("reviewLabel", () => {
  it("reads the label in parentheses", () => {
    expect(reviewLabel("86% (Very Positive)")).toBe("Very Positive");
    expect(reviewLabel("100% (3 user reviews)")).toBe("3 user reviews");
    expect(reviewLabel("60% ( Mixed )")).toBe("Mixed");
  });

  it("has none without one", () => {
    expect(reviewLabel("No reviews")).toBeNull();
    expect(reviewLabel("86%")).toBeNull();
    expect(reviewLabel("86% (unclosed")).toBeNull();
    expect(reviewLabel(null)).toBeNull();
  });
});
