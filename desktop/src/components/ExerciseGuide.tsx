import { EXERCISES, type Exercise } from "../core/engine";

import { CameraPlacementGuide, type CameraGuide } from "./CameraPlacementGuide";

const guides: Record<Exercise, CameraGuide> = {
  squat: {
    title: "深蹲请侧身",
    detail: "肩、髋、膝、踝完整入镜",
    description: "摄像头从身体侧面拍摄，站直准备，肩髋膝踝入镜",
    cameraY: 35,
    head: [86, 10],
    body: "M86 16V43L82 59V73H94",
    limbs: "M86 26L98 39",
    joints: [
      [86, 26],
      [86, 43],
      [82, 59],
      [82, 73],
    ],
  },
  pushup: {
    title: "多角度俯卧撑",
    detail: "先推起停稳，再完整往返",
    description:
      "摄像头放低从侧面拍摄，手掌朝向头部一侧、手腕在肩下方，身体保持直线，全身入镜",
    cameraY: 53,
    head: [62, 37],
    body: "M67 42L75 47L96 55L118 64L113 74",
    limbs: "M75 47V60V74H63",
    joints: [
      [75, 47],
      [75, 60],
      [75, 74],
    ],
  },
  bench: {
    title: "卧推请侧拍",
    detail: "镜头与躺卧时的头部等高",
    description:
      "摄像头与躺卧时的头部等高，从卧推凳侧面拍摄，背部有支撑、双脚着地，重量位于胸肩上方",
    cameraY: 52,
    head: [62, 53],
    body: "M68 56H94H110V74H121",
    limbs: "M75 56V41V26",
    joints: [
      [75, 56],
      [75, 41],
      [75, 26],
    ],
    equipment: "M55 61H99M60 61V74M96 61V74M65 26H85M67 22V30M83 22V30",
  },
  deadlift: {
    title: "硬拉请侧身",
    detail: "肩、髋、膝与脚部完整入镜",
    description:
      "摄像头从侧面拍摄硬拉，髋部后移、背部平直、手臂向下，重量靠近小腿，双脚着地",
    cameraY: 36,
    head: [82, 19],
    body: "M87 24L90 27L108 42L94 59L102 74H88",
    limbs: "M90 27V46V65",
    joints: [
      [90, 27],
      [108, 42],
      [94, 59],
    ],
    equipment: "M79 65H101M82 60V70M98 60V70",
  },
  lunge: {
    title: "弓步蹲请侧身",
    detail: "前后腿与双脚完整入镜",
    description: "摄像头从侧面拍摄前后分腿的弓步姿态，髋膝脚踝与双脚入镜",
    cameraY: 36,
    head: [84, 10],
    body: "M84 16L87 43L67 54V74H57M87 43L104 64L118 65L113 74",
    limbs: "M85 26L74 37L65 33",
    joints: [
      [87, 43],
      [67, 54],
      [67, 74],
      [104, 64],
      [118, 65],
    ],
  },
  shoulder_press: {
    title: "推举请正对镜头",
    detail: "举过头顶时，双手仍在画面内",
    description: "正面拍摄肩上推举，左右手持哑铃举过头顶，双手始终入镜",
    cameraY: 35,
    head: [91, 23],
    body: "M91 29V53M83 35H99M91 53L82 73H76M91 53L100 73H106",
    limbs: "M83 35L73 26V10M99 35L109 26V10",
    joints: [
      [83, 35],
      [73, 26],
      [73, 10],
      [99, 35],
      [109, 26],
      [109, 10],
    ],
    equipment: "M65 8H81M67 4V12M79 4V12M101 8H117M103 4V12M115 4V12",
  },
  curl: {
    title: "弯举请略微侧身",
    detail: "肩、肘、手腕完整入镜",
    description: "侧面或略侧面拍摄二头弯举，屈肘举起哑铃，肩肘手腕入镜",
    cameraY: 35,
    head: [86, 10],
    body: "M86 16V46L83 60V73H94",
    limbs: "M86 26L85 43L103 31",
    joints: [
      [86, 26],
      [85, 43],
      [103, 31],
    ],
    equipment: "M98 26L108 36M96 28L100 24M106 38L110 34",
  },
  pullup: {
    title: "引体请正对镜头",
    detail: "单杠、双手与上半身入镜",
    description:
      "正面拍摄引体向上，双手握住单杠，身体悬垂、双脚离地，单杠双手肩肘入镜",
    cameraY: 35,
    head: [91, 29],
    body: "M91 35V54M83 41H99M91 54L87 62V69H82M91 54L95 62V69H100",
    limbs: "M83 41L72 29L74 8M99 41L110 29L108 8",
    joints: [
      [83, 41],
      [72, 29],
      [74, 8],
      [99, 41],
      [110, 29],
      [108, 8],
    ],
    equipment: "M63 8H119M63 4V14M119 4V14",
    ground: false,
  },
  plank: {
    title: "平板支撑请侧拍",
    detail: "镜头放低，肩、髋、脚踝入镜",
    description:
      "摄像头放低从侧面拍摄平板支撑，肘在肩下方，前臂朝头部一侧贴地，肩髋脚踝保持直线",
    cameraY: 53,
    head: [60, 50],
    body: "M66 51L74 52L96 56L118 60L113 74",
    limbs: "M74 52V74H54",
    joints: [
      [74, 52],
      [96, 56],
      [118, 60],
    ],
  },
};

export function ExerciseGuide({ exercise }: { exercise: Exercise }) {
  return (
    <CameraPlacementGuide
      name={EXERCISES[exercise].label}
      guide={guides[exercise]}
    />
  );
}
