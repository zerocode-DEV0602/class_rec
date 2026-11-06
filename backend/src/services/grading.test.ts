import { describe, expect, it } from "vitest";
import { calculateWeightedGrade } from "./grading";

describe("calculateWeightedGrade", () => {
  it("computes points-based category averages and weighted final grades", () => {
    const result = calculateWeightedGrade([
      {
        categoryId: "written",
        weight: 30,
        method: "points",
        assessments: [
          { maxScore: 20, score: 16 },
          { maxScore: 15, score: 12 },
        ],
      },
      {
        categoryId: "tasks",
        weight: 50,
        method: "points",
        assessments: [{ maxScore: 50, score: 45 }],
      },
      {
        categoryId: "exam",
        weight: 20,
        method: "points",
        assessments: [{ maxScore: 100, score: 90 }],
      },
    ]);
    expect(result.categoryResults.map((item) => item.average)).toEqual([
      80, 90, 90,
    ]);
    expect(result.finalGrade).toBe(87);
  });

  it("supports equal-average categories and configurable rounding", () => {
    const result = calculateWeightedGrade(
      [
        {
          categoryId: "tasks",
          weight: 100,
          method: "equal_average",
          assessments: [
            { maxScore: 3, score: 2 },
            { maxScore: 7, score: 6 },
          ],
        },
      ],
      { decimals: 1 },
    );
    expect(result.categoryResults[0].average).toBe(76.2);
    expect(result.finalGrade).toBe(76.2);
  });

  it("returns incomplete grades when missing scores are excluded", () => {
    const result = calculateWeightedGrade([
      {
        categoryId: "one",
        weight: 100,
        method: "points",
        assessments: [{ maxScore: 10, score: 8 }, { maxScore: 10 }],
      },
    ]);
    expect(result.categoryResults[0].missingCount).toBe(1);
    expect(result.categoryResults[0].average).toBe(80);
    expect(result.finalGrade).toBe(80);
  });

  it("treats missing assessments as zero when the policy requires it", () => {
    const result = calculateWeightedGrade(
      [
        {
          categoryId: "one",
          weight: 100,
          method: "points",
          assessments: [{ maxScore: 10, score: 8 }, { maxScore: 10 }],
        },
      ],
      { missingScorePolicy: "zero" },
    );
    expect(result.categoryResults[0].average).toBe(40);
    expect(result.finalGrade).toBe(40);
  });

  it("rejects invalid weight totals, out-of-range scores, and precision", () => {
    expect(() =>
      calculateWeightedGrade([
        { categoryId: "one", weight: 90, method: "points", assessments: [] },
      ]),
    ).toThrow(/must total 100/);
    expect(() =>
      calculateWeightedGrade([
        {
          categoryId: "one",
          weight: 100,
          method: "points",
          assessments: [{ maxScore: 10, score: 11 }],
        },
      ]),
    ).toThrow(/between zero/);
    expect(() =>
      calculateWeightedGrade(
        [{ categoryId: "one", weight: 100, method: "points", assessments: [] }],
        { decimals: 5 },
      ),
    ).toThrow(/precision/);
  });
});
