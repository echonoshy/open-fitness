import { EXERCISES } from "./engine";

export interface WaitingContext {
  request: string;
  exercise?: string;
  previousRequest?: string;
  /** Only supplied once a real query has started. */
  stage?: string;
}

const normalized = (text: string) => text.replace(/[\p{P}\p{Z}\s]/gu, "");

/** Presentation only: these intentions never route or execute a request. */
export class WaitingFeedbackPhrases {
  private recent: string[] = [];

  remember(text: string) {
    this.recent = [...this.recent, normalized(text)].slice(-6);
  }

  allows(text: string) {
    return !this.recent.includes(normalized(text));
  }

  choose({ request, exercise, previousRequest, stage }: WaitingContext) {
    if (
      previousRequest &&
      /^(?:那)?(?:这个呢|这样呢|还有呢|为什么呢|还是不行|怎么回事|然后呢|继续说)[。！？?!\s]*$/.test(
        request.trim(),
      )
    )
      request = `${previousRequest} ${request}`;
    const named = Object.values(EXERCISES).find((item) =>
      request.includes(item.label),
    )?.label;
    const current = Object.entries(EXERCISES).find(
      ([key]) => key === exercise,
    )?.[1].label;
    const scope = request.match(/上周|本周|这周|上次|今天|最近/)?.[0] ?? "";
    let focus: string;
    let candidates: string[];
    if (
      /训练记录/.test(stage ?? "") ||
      (!stage && /记录|上次|上周|本周|这周|历史|进步|退步|统计/.test(request))
    ) {
      focus = `${scope}${named ?? (scope ? "" : "训练")}记录`;
      candidates = [
        `我看看${focus}。`,
        `我核对下${focus}。`,
        `我翻一下${focus}。`,
        `我理一下${focus}。`,
      ];
    } else if (
      /配片/.test(stage ?? "") ||
      (!stage && /配片|杠铃片/.test(request))
    ) {
      candidates = [
        "我算一下怎么配片。",
        "我看看怎么配片。",
        "我核对下配片。",
        "我算算两边怎么放。",
      ];
    } else if (/保存的资料/.test(stage ?? "")) {
      candidates = [
        "我看看你的资料。",
        "我核对下资料。",
        "我翻一下保存的信息。",
        "我对照下你的资料。",
      ];
    } else if (
      !stage &&
      /计数|不算|没算|识别|入镜|看不到|检测|数错/.test(request)
    ) {
      candidates = [
        "我看看识别状态。",
        "我核对下计数条件。",
        "我看看检测情况。",
        "我确认下识别情况。",
      ];
    } else if (!stage && /画面|镜头|取景|放大|缩小|跟随/.test(request)) {
      candidates = [
        "我看看当前取景。",
        "我确认下取景要求。",
        "我先看看画面设置。",
        "我对照下取景状态。",
      ];
    } else if (!stage && /饮食|吃|营养|蛋白|热量/.test(request)) {
      candidates = [
        "我想想饮食搭配。",
        "我理一下饮食建议。",
        "我看看怎么吃合适。",
        "让我想想怎么搭配。",
      ];
    } else if (
      !stage &&
      /切换|换成|改成|设为|设置|调整|开始|继续训练|休息|暂停|新一组|记住/.test(
        request,
      )
    ) {
      candidates = [
        "我确认下你的要求。",
        "我先理一下你的要求。",
        "我对照下当前设置。",
        "我确认下当前状态。",
      ];
    } else if (
      /动作资料/.test(stage ?? "") ||
      (!stage && (named || /这个动作/.test(request)))
    ) {
      focus =
        named ?? (/这个动作/.test(request) ? current : undefined) ?? "动作";
      candidates = [
        `我看看${focus}要点。`,
        `我梳理下${focus}要点。`,
        `我查一下${focus}资料。`,
        `我理一下${focus}要领。`,
      ];
    } else if (!stage && /计划|安排|怎么练|练什么|训练量/.test(request)) {
      candidates = [
        "我想想怎么安排。",
        "我理一下训练安排。",
        "我看看怎么练合适。",
        "我梳理下训练建议。",
      ];
    } else {
      candidates = [
        "我想一下。",
        "我先理一下。",
        "让我想想。",
        "我整理一下思路。",
      ];
    }
    // Prefer an unheard phrase; if all variants were heard, use the least recent.
    return candidates.sort(
      (a, b) =>
        this.recent.lastIndexOf(normalized(a)) -
        this.recent.lastIndexOf(normalized(b)),
    )[0];
  }
}
