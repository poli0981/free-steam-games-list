import { describe, expect, it } from "vitest";
import { parseReviewPercent, reviewLabel } from "./utils";

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
