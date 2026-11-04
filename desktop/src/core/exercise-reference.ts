import { primaryMovementSlugs } from "./movement-library";
import { EXERCISES, type Exercise } from "./engine";

export interface ExerciseReference {
  video: string;
  poster: string;
  points: readonly [string, string, string];
}

const reference = (
  exercise: Exercise,
  points: ExerciseReference["points"],
): ExerciseReference => ({
  video: `./movekit-library/hd/${primaryMovementSlugs[exercise]}.mp4`,
  poster: `./movekit-library/hd/${primaryMovementSlugs[exercise]}.webp`,
  points,
});

/** Demonstration content, separate from personal trajectory/scoring references. */
export const EXERCISE_REFERENCES: Record<Exercise, ExerciseReference> = {
  squat: reference("squat", [
    "双脚站稳，重心保持在全脚掌",
    "屈髋屈膝下蹲，膝盖朝向脚尖",
    "保持躯干稳定，有控制地站起",
  ]),
  pushup: reference("pushup", [
    "双手撑稳，头、躯干与腿保持一线",
    "屈肘缓慢下放，避免塌腰或抬臀",
    "推地撑起，全程保持身体稳定",
  ]),
  bench: reference("bench", [
    "背部稳靠卧推凳，双脚踩实地面",
    "手腕保持稳定，缓慢下放杠铃",
    "平稳推起，避免借胸部反弹",
  ]),
  deadlift: reference("deadlift", [
    "收紧躯干，先让髋部向后移动",
    "背部保持自然，重量贴近身体",
    "平稳站起，避免猛拉或过度后仰",
  ]),
  lunge: reference("lunge", [
    "向前迈步，前脚踩稳再下蹲",
    "前膝朝向脚尖，躯干保持稳定",
    "前脚发力回位，再换另一侧",
  ]),
  shoulder_press: reference("shoulder_press", [
    "双脚站稳，哑铃从肩部附近起始",
    "收紧躯干，避免挺腰借力",
    "平稳举过头顶，再控制下放",
  ]),
  curl: reference("curl", [
    "上臂靠近身体，手腕保持自然",
    "屈肘举起哑铃，避免身体摆动",
    "缓慢下放，全程控制重量",
  ]),
  pullup: reference("pullup", [
    "握稳单杠，保持肩部与躯干稳定",
    "有控制地向上拉，避免甩腿摆荡",
    "缓慢下放，避免突然松力下坠",
  ]),
  plank: reference("plank", [
    "前臂撑地，肘部位于肩部下方",
    "头、躯干与腿保持一线",
    "保持呼吸，避免塌腰或抬臀",
  ]),
};

export function exerciseReferenceInfo(exercise: Exercise) {
  return {
    exercise,
    name: EXERCISES[exercise].label,
    points: EXERCISE_REFERENCES[exercise].points,
    description: "动作示范与一般要点，不代表对当前用户姿态的判断。",
  };
}

/** Exact basic-introduction requests only; questions and compound requests use the coach. */
export function localExerciseIntroduction(text: string, current: Exercise) {
  const clean = text.trim().replace(/[。！!，,\s]+$/g, "");
  const match = /^(?:请)?(?:讲一下|介绍一下)(.+?)(?:的)?(?:动作)?要点$/.exec(
    clean,
  );
  if (!match) return null;
  const subject = match[1].replace(/的$/, "");
  const exercise = ["这个动作", "当前动作", "这个", "当前"].includes(subject)
    ? current
    : (Object.keys(EXERCISES) as Exercise[]).find(
        (id) => EXERCISES[id].label === subject,
      );
  return exercise ? exerciseReferenceInfo(exercise) : null;
}

export function exerciseNarrationSegments(exercise: Exercise) {
  return [
    `${EXERCISES[exercise].label}记住这三点。`,
    ...EXERCISE_REFERENCES[exercise].points.map((point) => `${point}。`),
  ];
}
export function exerciseNarrationText(exercise: Exercise) {
  const info = exerciseReferenceInfo(exercise);
  return `${info.name}记住这三点：\n${info.points.map((point, index) => `${index + 1}. ${point}。`).join("\n")}`;
}
