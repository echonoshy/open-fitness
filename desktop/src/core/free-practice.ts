import type { Data } from "../platform";

export const DEFAULT_PRACTICE_MOVEMENTS = [
  "bodyweight-squat",
  "push-up",
  "forward-lunge",
  "front-plank",
];

export function practiceMovements(data: Pick<Data, "freePractice">): string[] {
  return data.freePractice?.movementSlugs ?? DEFAULT_PRACTICE_MOVEMENTS;
}

export function updatePracticeMovements(
  data: Data,
  update: (current: string[]) => string[],
): Data {
  return {
    ...data,
    freePractice: {
      movementSlugs: [...new Set(update([...practiceMovements(data)]))],
    },
  };
}
