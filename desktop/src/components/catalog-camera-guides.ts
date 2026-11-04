import assignments from "../core/movement-camera-setups.json";
import type { CameraGuide } from "./CameraPlacementGuide";

type Figure = Pick<
  CameraGuide,
  "head" | "body" | "limbs" | "joints" | "equipment" | "ground"
>;
const side: Figure = {
  head: [86, 10],
  body: "M86 16V43L83 59V73H94",
  limbs: "M86 25L91 43L94 52",
  joints: [
    [86, 25],
    [86, 43],
    [83, 59],
    [83, 73],
  ],
};
const front: Figure = {
  head: [90, 10],
  body: "M90 16V45M79 23L101 23M90 45L78 74H72M90 45L102 74H108",
  limbs: "M79 23L73 41L70 51M101 23L107 41L110 51",
  joints: [
    [79, 23],
    [101, 23],
    [78, 74],
    [102, 74],
  ],
};
const oblique: Figure = {
  ...front,
  body: "M88 16L89 44M80 24L96 21M89 44L82 73H75M89 44L100 68H105",
  limbs: "M80 24L78 41L64 43M96 21L99 36L90 40",
  head: [88, 10],
  joints: [
    [80, 24],
    [78, 41],
    [64, 43],
  ],
};
const raised: Figure = {
  ...front,
  head: [90, 21],
  body: "M90 27V49M80 31H100M90 49L81 73H74M90 49L100 73H107",
  limbs: "M80 31L72 23V6M100 31L108 23V6",
  joints: [
    [72, 6],
    [72, 23],
    [80, 31],
    [100, 31],
    [108, 23],
    [108, 6],
  ],
};
const hinge: Figure = {
  head: [71, 26],
  body: "M76 30L83 34L103 42L94 57L100 73H89",
  limbs: "M83 34L81 48L79 61",
  joints: [
    [83, 34],
    [103, 42],
    [94, 57],
    [79, 61],
  ],
};
const benchRow: Figure = {
  head: [65, 26],
  body: "M70 29L76 31L101 35L109 54L114 74H105M100 35L96 54H79",
  limbs: "M75 31L70 42L69 53M80 32L84 44L87 60",
  equipment: "M60 55H101M64 56V75M97 56V75M83 60H92M83 57V63M92 57V63",
  joints: [
    [80, 32],
    [84, 44],
    [87, 60],
    [101, 35],
  ],
};
const seated: Figure = {
  head: [88, 19],
  body: "M88 25L90 48L72 50V73H63",
  limbs: "M87 32L83 44L68 40",
  equipment: "M81 54H100M98 54V75",
  joints: [
    [87, 32],
    [83, 44],
    [68, 40],
    [90, 48],
    [72, 50],
    [72, 73],
  ],
};
const seatFront: Figure = {
  head: [91, 17],
  body: "M91 23V48M81 29H101M91 48L75 53V73H69M91 48L107 53V73H113",
  limbs: "M81 29L74 41L68 39M101 29L108 41L114 39",
  equipment: "M80 54H102M82 54V74M100 54V74",
  joints: [
    [81, 29],
    [101, 29],
    [75, 53],
    [107, 53],
  ],
};
const knees: Figure = {
  head: [85, 24],
  body: "M85 30L86 50L85 70H108L114 74",
  limbs: "M85 38L79 51L68 47",
  joints: [
    [85, 38],
    [86, 50],
    [85, 70],
    [108, 70],
  ],
};
const bentLegs: Figure = {
  head: [61, 65],
  body: "M66 68L76 70H91L102 49L113 72H121",
  limbs: "M75 70L87 72H96",
  joints: [
    [76, 70],
    [91, 70],
    [102, 49],
    [113, 72],
  ],
};
const lyingBench: Figure = {
  head: [63, 48],
  body: "M69 51L75 53H95L110 55V74H120",
  limbs: "M75 53L77 40L76 29",
  equipment: "M55 59H102M61 60V75M96 60V75",
  joints: [
    [75, 53],
    [77, 40],
    [76, 29],
  ],
};
const faceDown: Figure = {
  head: [61, 60],
  body: "M67 63L76 65L94 68L118 70",
  limbs: "M76 65L67 73H54",
  joints: [
    [76, 65],
    [94, 68],
    [107, 69],
    [118, 70],
  ],
};
const floorSupport: Figure = {
  head: [60, 43],
  body: "M65 46L73 49L95 56L118 65L112 74",
  limbs: "M73 49L72 61L71 74H62",
  joints: [
    [73, 49],
    [71, 74],
    [95, 56],
    [118, 65],
  ],
};
const hang: Figure = {
  head: [90, 28],
  body: "M90 34V54M82 38H98M90 54L84 71M90 54L97 71",
  limbs: "M82 38L77 24L74 8M98 38L103 24L107 8",
  equipment: "M62 8H119M62 5V13M119 5V13",
  joints: [
    [74, 8],
    [82, 38],
    [98, 38],
    [107, 8],
  ],
  ground: false,
};
const setup = (
  figure: Figure,
  cameraY: number,
  title: string,
  detail: string,
): CameraGuide => ({ ...figure, cameraY, title, detail });

const guides = {
  standingSide: setup(
    side,
    38,
    "侧身对镜头",
    "镜头与髋同高，肩、髋、膝和脚踝入镜",
  ),
  standingFront: setup(
    front,
    36,
    "正面对镜头",
    "镜头与腰同高，左右两侧都给手脚留空间",
  ),
  armsOblique: setup(
    oblique,
    32,
    "从侧前方拍",
    "镜头与肘同高，靠镜头一侧的肩、肘、腕都入镜",
  ),
  overhead: setup(
    raised,
    34,
    "从正前方拍",
    "镜头与胸同高，举到最高时双手仍在画面内",
  ),
  hinge: setup(hinge, 41, "从身体侧面拍", "镜头与髋同高，肩、髋、膝和双手入镜"),
  benchRow: setup(
    benchRow,
    36,
    "从持铃手一侧拍",
    "镜头与髋同高，凳沿别挡住肩、肘和手腕",
  ),
  chestSupported: setup(
    { ...hinge, equipment: "M77 37L100 49M80 39V74M96 48V74" },
    38,
    "从凳子侧前方拍",
    "镜头与胸垫同高，肩、肘和双手露出凳沿",
  ),
  bench: setup(
    lyingBench,
    48,
    "从卧凳侧面拍",
    "镜头与躺卧时的肩同高，肩、肘、腕都入镜",
  ),
  inclineBench: setup(
    {
      ...lyingBench,
      head: [65, 32],
      body: "M69 36L75 41L95 55H110V74H120",
      limbs: "M75 41L78 30L77 16",
      equipment: "M60 39L91 59H102M65 43V75M96 60V75",
      joints: [
        [75, 41],
        [78, 30],
        [77, 16],
      ],
    },
    43,
    "从凳子侧面拍",
    "按靠背角度调镜头高度，肩和手臂全程入镜",
  ),
  declineBench: setup(
    {
      ...lyingBench,
      head: [63, 55],
      body: "M68 56L77 53L97 44L111 39L118 53",
      limbs: "M77 53L79 39L78 29",
      equipment: "M56 64L112 44M63 62V74M105 48V74",
      joints: [
        [77, 53],
        [79, 39],
        [78, 29],
        [97, 44],
      ],
    },
    49,
    "从下斜凳侧面拍",
    "镜头对准躯干，头、肩和手臂都在画面内",
  ),
  proneLegs: setup(
    {
      ...faceDown,
      head: [61, 40],
      body: "M67 43L75 45L93 46L116 47",
      limbs: "M75 45L67 54H59",
      equipment: "M59 50H101M62 51V74M98 51V74",
      joints: [
        [75, 45],
        [93, 46],
        [104, 47],
        [116, 47],
      ],
    },
    46,
    "从腿弯举一侧拍",
    "镜头与支撑垫同高，别让滚垫挡住膝和脚踝",
  ),
  wallSit: setup(
    { ...seated, equipment: "M96 13V75" },
    49,
    "沿墙从侧面拍",
    "镜头对着髋、膝和脚踝，双脚拍全",
  ),
  suspendedRow: setup(
    {
      ...floorSupport,
      head: [67, 42],
      body: "M72 45L79 48L97 58L117 66L120 72",
      limbs: "M79 48L76 34L73 23",
      equipment: "M63 22H88",
      joints: [
        [79, 48],
        [76, 34],
        [73, 23],
        [97, 58],
      ],
    },
    47,
    "从杆架侧面拍",
    "镜头对准躯干，双手、髋和脚同框",
  ),
  floorOverhead: setup(
    {
      head: [83, 33],
      body: "M83 39L88 63L106 68H120",
      limbs: "M83 44L75 33V12M85 43L95 33V12",
      joints: [
        [83, 44],
        [75, 12],
        [95, 12],
        [88, 63],
      ],
    },
    43,
    "坐姿从斜前方拍",
    "镜头与坐姿胸口同高，举起双手时头顶留空",
  ),
  benchFly: setup(
    lyingBench,
    48,
    "从凳脚斜前方拍",
    "镜头略高于凳面，两臂展开时双手仍入镜",
  ),
  seatedArms: setup(
    seated,
    35,
    "从座椅侧前方拍",
    "镜头与坐姿胸口同高，器械别挡住肩、肘、腕",
  ),
  seatedLegs: setup(
    seated,
    53,
    "从座椅侧面拍",
    "镜头对准髋和膝，脚伸到最远时仍在画面内",
  ),
  seatedFront: setup(
    seatFront,
    39,
    "坐姿正对镜头",
    "镜头与坐姿腰部同高，双肩和两膝都入镜",
  ),
  seatedOverhead: setup(
    {
      ...seatFront,
      limbs: "M81 29L73 21V6M101 29L109 21V6",
      joints: [
        [81, 29],
        [73, 6],
        [101, 29],
        [109, 6],
      ],
    },
    34,
    "坐姿从斜前方拍",
    "镜头与胸同高，避开器械立柱，头顶为双手留空",
  ),
  hanging: setup(
    hang,
    33,
    "正对单杠拍",
    "镜头后移，单杠、双手和悬空的脚同时入镜",
  ),
  hangingSide: setup(
    hang,
    40,
    "从支架侧前方拍",
    "拍到肩、髋和脚，身体前方为抬腿留空间",
  ),
  supine: setup(bentLegs, 63, "从垫子侧面拍", "镜头放低，从肩到脚都拍进画面"),
  hipThrust: setup(
    {
      ...bentLegs,
      head: [62, 43],
      body: "M67 46L75 50L91 61L106 52L112 72H120",
      limbs: "M75 50L87 58L92 59",
      equipment: "M54 54H78M59 54V75M74 54V75",
      joints: [
        [75, 50],
        [91, 61],
        [106, 52],
        [112, 72],
      ],
    },
    51,
    "从支撑垫侧面拍",
    "镜头与髋同高，肩、髋、膝和脚跟入镜",
  ),
  prone: setup(
    faceDown,
    63,
    "从身体侧面拍",
    "镜头略高于垫面，肩、髋、膝和脚踝都入镜",
  ),
  floorSupport: setup(
    floorSupport,
    56,
    "低机位从侧面拍",
    "镜头略高于支撑面，手、肩、髋和脚都入镜",
  ),
  allFours: setup(
    {
      head: [66, 39],
      body: "M71 42L77 44H98L99 70H114",
      limbs: "M77 44V71H68",
      joints: [
        [77, 44],
        [77, 71],
        [98, 44],
        [99, 70],
      ],
    },
    56,
    "从垫子侧前方拍",
    "镜头对准躯干，手和膝入镜，四周留出空间",
  ),
  sideLying: setup(
    {
      ...floorSupport,
      head: [65, 45],
      body: "M70 48L77 51L97 59L117 69H122",
      limbs: "M77 51L73 71H59M80 51L91 45",
      joints: [
        [77, 51],
        [73, 71],
        [97, 59],
        [117, 69],
      ],
    },
    57,
    "镜头朝向胸腹一侧",
    "镜头略高于支撑面，肩、髋和双脚都拍全",
  ),
  kneeling: setup(
    knees,
    49,
    "跪姿从侧面拍",
    "镜头与跪姿髋部同高，肩、髋、膝和脚都入镜",
  ),
  kneelingOblique: setup(
    knees,
    41,
    "跪姿从斜前方拍",
    "镜头与跪姿胸口同高，双手和双膝入镜",
  ),
  wideVertical: setup(
    side,
    38,
    "从侧前方拍全身",
    "镜头固定在腰高处，头顶和脚下都留出余量",
  ),
  travel: setup(
    side,
    38,
    "从路线侧面拍",
    "镜头与腰同高，移动路线和脚下留足空间",
  ),
  lowerLeg: setup(
    side,
    60,
    "从小腿侧面拍",
    "镜头降到膝盖附近，膝、脚跟和脚尖完整入镜",
  ),
  splitStance: setup(
    {
      ...side,
      body: "M86 16V43L71 57L66 73H57M86 43L101 60L113 71H119",
      joints: [
        [86, 43],
        [71, 57],
        [66, 73],
        [101, 60],
        [113, 71],
      ],
    },
    41,
    "从前后腿的侧面拍",
    "镜头与髋同高，前脚和后脚都留在画面里",
  ),
  bike: setup(
    {
      ...seated,
      body: "M88 25L93 46L78 56L86 69H77",
      limbs: "M88 31L80 39L68 41",
      equipment: "M86 50H101M91 50V64L72 48L67 39H60",
      joints: [
        [88, 31],
        [93, 46],
        [78, 56],
        [86, 69],
      ],
    },
    47,
    "从车身侧面拍",
    "镜头与车座同高，肩、髋、膝和踏板入镜",
  ),
  rowErg: setup(
    {
      ...seated,
      body: "M88 25L92 52L78 44L65 66H58",
      limbs: "M87 32L75 39L61 42",
      equipment: "M63 71H117M85 57H101",
      joints: [
        [87, 32],
        [92, 52],
        [78, 44],
        [65, 66],
      ],
    },
    44,
    "从滑轨侧面拍",
    "镜头与坐姿腰部同高，手柄和滑座全程入镜",
  ),
  floorSeated: setup(
    {
      head: [83, 32],
      body: "M83 38L88 63L106 68H120",
      limbs: "M83 45L90 53L99 48",
      joints: [
        [83, 45],
        [88, 63],
        [106, 68],
        [120, 68],
      ],
    },
    49,
    "坐姿从斜前方拍",
    "镜头与坐姿胸口同高，双肩、髋和双脚入镜",
  ),
  dip: setup(
    {
      ...side,
      head: [86, 16],
      body: "M86 22V47L92 60L101 67",
      limbs: "M86 29L82 39L85 48",
      equipment: "M75 49H102",
      joints: [
        [86, 29],
        [82, 39],
        [85, 48],
      ],
      ground: false,
    },
    37,
    "从支架侧面拍",
    "镜头与肘同高，避开横杆，肩、肘和手腕入镜",
  ),
} satisfies Record<string, CameraGuide>;

export function catalogCameraGuide(slug: string): CameraGuide | undefined {
  const id: string | undefined = (assignments as Record<string, string>)[slug];
  if (id === "timer") return undefined;
  return Object.hasOwn(guides, id)
    ? guides[id as keyof typeof guides]
    : undefined;
}
