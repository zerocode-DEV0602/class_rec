export type CategoryInput = {
  categoryId: string;
  weight: number;
  method: "points" | "equal_average";
  assessments: { maxScore: number; score?: number | null }[];
};
export type GradeResult = {
  categoryId: string;
  average: number | null;
  weight: number;
  missingCount: number;
};

export function calculateWeightedGrade(
  categories: CategoryInput[],
  options: { decimals?: number; missingScorePolicy?: "exclude" | "zero" } = {},
): { categoryResults: GradeResult[]; finalGrade: number | null } {
  if (categories.length === 0) return { categoryResults: [], finalGrade: null };
  const totalWeight = categories.reduce(
    (sum, category) => sum + category.weight,
    0,
  );
  if (Math.abs(totalWeight - 100) > 0.001)
    throw new Error("Grading category weights must total 100%.");
  const decimals = options.decimals ?? 2;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4)
    throw new Error("Rounding precision must be between 0 and 4 decimals.");
  const factor = 10 ** decimals;
  const categoryResults = categories.map((category): GradeResult => {
    const valid = category.assessments.filter(
      (item) => Number.isFinite(item.maxScore) && item.maxScore > 0,
    );
    const scored = valid.filter(
      (item) => item.score !== undefined && item.score !== null,
    );
    for (const item of scored) {
      if (
        !Number.isFinite(item.score) ||
        (item.score as number) < 0 ||
        (item.score as number) > item.maxScore
      ) {
        throw new Error(
          "Score must be between zero and the assessment's maximum score.",
        );
      }
    }
    const missingCount = valid.length - scored.length;
    const selected = options.missingScorePolicy === "zero" ? valid : scored;
    if (selected.length === 0)
      return {
        categoryId: category.categoryId,
        average: null,
        weight: category.weight,
        missingCount,
      };
    const average =
      category.method === "equal_average"
        ? selected.reduce(
            (sum, item) => sum + ((item.score ?? 0) / item.maxScore) * 100,
            0,
          ) / selected.length
        : (() => {
            const earned = selected.reduce(
              (sum, item) => sum + (item.score ?? 0),
              0,
            );
            const possible = selected.reduce(
              (sum, item) => sum + item.maxScore,
              0,
            );
            return possible > 0 ? (earned / possible) * 100 : null;
          })();
    return {
      categoryId: category.categoryId,
      average: average === null ? null : Math.round(average * factor) / factor,
      weight: category.weight,
      missingCount,
    };
  });
  if (
    options.missingScorePolicy !== "zero" &&
    categoryResults.some((result) => result.average === null)
  ) {
    return { categoryResults, finalGrade: null };
  }
  const finalGrade = categoryResults.reduce(
    (sum, result) => sum + ((result.average ?? 0) * result.weight) / 100,
    0,
  );
  return {
    categoryResults,
    finalGrade: Math.round(finalGrade * factor) / factor,
  };
}
