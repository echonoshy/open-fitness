import type { categories } from "../core/knowledge";

type ProfileGuide = {
  label: string;
  description: string;
  use: string;
  topics: { key: string; question: string; example: string }[];
};

export const profileCopy: Record<(typeof categories)[number], ProfileGuide> = {
  identity: {
    label: "基本资料",
    description: "从一个称呼开始，告诉教练你愿意分享的信息。",
    use: "帮助教练以你习惯的方式称呼你，理解你的日常背景。",
    topics: [
      {
        key: "称呼",
        question: "你希望教练怎么称呼你？",
        example: "例如：叫我小林就好",
      },
      {
        key: "日常状态",
        question: "你平时的工作和生活是什么节奏？",
        example: "例如：在办公室工作，大部分时间坐着，晚上比较有空",
      },
    ],
  },
  body: {
    label: "身体情况",
    description: "描述你现在的状态，让建议更贴近你的起点。",
    use: "作为解释动作和给出建议时的背景，不会改变动作评分标准。",
    topics: [
      {
        key: "训练基础",
        question: "你之前有怎样的训练经历？",
        example: "例如：刚开始健身，会做一些自重动作，还不熟悉器械",
      },
      {
        key: "日常活动",
        question: "你平时有多少活动量？",
        example: "例如：每天步行半小时，周末偶尔骑车",
      },
      {
        key: "身高与体重",
        question: "有哪些身体信息想让教练了解？",
        example: "例如：身高 175 厘米，目前体重 70 公斤",
      },
    ],
  },
  goals: {
    label: "训练目标",
    description: "告诉教练你想要的变化，不需要先写一份完整计划。",
    use: "让教练在推荐动作、解释训练思路时参考你的目标。",
    topics: [
      {
        key: "主要目标",
        question: "你希望通过训练达到什么目标？",
        example: "例如：改善体能，让日常爬楼和走路更轻松",
      },
      {
        key: "重点部位",
        question: "你想重点训练哪些部位？",
        example: "例如：想加强背部和核心，也希望兼顾全身",
      },
      {
        key: "阶段期待",
        question: "接下来一段时间，你希望看到什么变化？",
        example: "例如：先坚持一个月，建立规律运动的习惯",
      },
    ],
  },
  injuries: {
    label: "伤病与限制",
    description: "记下你希望教练在建议中留意的情况。",
    use: "会作为回答时的限制条件；保存后不会自动禁用动作。",
    topics: [
      {
        key: "需要留意的情况",
        question: "有什么身体情况需要教练留意？",
        example: "例如：右肩之前受过伤，希望给建议时考虑这个情况",
      },
      {
        key: "动作限制",
        question: "有哪些动作或训练方式需要避开？",
        example: "例如：医生建议暂时避免跳跃，请在推荐时考虑",
      },
    ],
  },
  equipment: {
    label: "可用器械",
    description: "告诉教练你手边有什么，方便讨论能做的训练。",
    use: "让动作建议更贴近你的器械和场地条件。",
    topics: [
      {
        key: "现有器械",
        question: "你有哪些可以使用的训练器械？",
        example: "例如：一对 5 公斤哑铃、一张瑜伽垫，没有其他器械",
      },
      {
        key: "训练场地",
        question: "你通常在哪里训练？",
        example: "例如：在家里的客厅，空间不大，希望尽量安静",
      },
    ],
  },
  schedule: {
    label: "时间偏好",
    description: "说说你能留给训练的时间，这里不会创建日程。",
    use: "在你询问训练安排时，帮助教练考虑可用时长和频率。",
    topics: [
      {
        key: "每次时长",
        question: "你每次大概能训练多久？",
        example: "例如：工作日二十分钟，周末可以留出四十分钟",
      },
      {
        key: "训练频率",
        question: "你希望多久训练一次？",
        example: "例如：每周三次，尽量隔一天练一次",
      },
      {
        key: "方便的时段",
        question: "什么时间训练对你比较方便？",
        example: "例如：通常在晚饭前，周末更喜欢上午",
      },
    ],
  },
  nutrition: {
    label: "饮食偏好",
    description: "按需分享饮食习惯，方便教练理解你的提问。",
    use: "在讨论饮食相关问题时参考，不会自动生成食谱或计算热量。",
    topics: [
      {
        key: "饮食习惯",
        question: "你有哪些想让教练了解的饮食习惯？",
        example: "例如：工作日常在食堂吃饭，周末自己做饭",
      },
      {
        key: "饮食限制",
        question: "有哪些食物需要避开？",
        example: "例如：乳糖不耐受，平时不喝普通牛奶",
      },
    ],
  },
  preferences: {
    label: "指导偏好",
    description: "让教练知道，你更喜欢怎样的交流方式。",
    use: "影响教练组织回答的方式；声音和音量仍在「设置」中调整。",
    topics: [
      {
        key: "回答方式",
        question: "你喜欢教练怎样回答你？",
        example: "例如：先说重点，每次建议简短一点，需要时我会继续问",
      },
      {
        key: "鼓励方式",
        question: "你喜欢怎样的鼓励和提醒？",
        example: "例如：平静、直接地提醒我，不需要频繁夸奖",
      },
    ],
  },
};
