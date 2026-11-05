import React from "react";
import {
  AbsoluteFill, Composition, Easing, Img, OffthreadVideo, Sequence,
  interpolate, registerRoot, staticFile, useCurrentFrame,
} from "remotion";

const fps = 24;
const ink = "#191c19";
const paper = "#f5f4eb";
const lime = "#d2ed9e";
const muted = "#a9b0a7";
const font = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function enter(frame, distance = 32) {
  const progress = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
  return { opacity: 0.25 + 0.75 * progress, transform: `translateY(${distance * (1 - progress)}px)` };
}

function Footage({name, from = 0, style}) {
  return <OffthreadVideo src={staticFile(name + ".mp4")} trimBefore={from} muted
    style={{display: "block", width: "100%", height: "100%", objectFit: "cover", ...style}}/>;
}

function Wordmark({dark = false, width = 209}) {
  return <Img src={staticFile("wordmark.svg")} style={{width, filter: dark ? "brightness(0)" : undefined}}/>;
}

function Intro() {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{background: ink}}>
    <div style={{position: "absolute", right: 0, top: 0, width: 814, height: 1080, overflow: "hidden"}}>
      <Footage name="squat" style={{objectFit: "cover", objectPosition: "center 50%", transform: "scale(1.015)"}}/>
    </div>
    <div style={{position: "absolute", left: 107, top: 85}}><Wordmark width={258}/></div>
    <div style={{position: "absolute", left: 108, top: 317, ...enter(frame)}}>
      <div style={{fontSize: 32, color: lime, letterSpacing: 3, fontWeight: 550}}>实机训练记录</div>
      <h1 style={{fontSize: 139, color: paper, lineHeight: 1.1, letterSpacing: -9, fontWeight: 650, margin: "30px 0 38px"}}>午间深蹲</h1>
      <div style={{fontSize: 43, color: "#d3d7ce", letterSpacing: 1}}>从挑动作，到数完这一组。</div>
    </div>
    <div style={{position: "absolute", bottom: 120, left: 110, width: 806, borderTop: "1px solid #596052", paddingTop: 21,
      display: "flex", alignItems: "baseline", justifyContent: "space-between", color: muted, fontSize: 28}}>
      <span>自重训练</span><span style={{color: lime, fontVariantNumeric: "tabular-nums"}}>1 组 / 3 次</span>
    </div>
  </AbsoluteFill>;
}

function Chapter({title, section, dark = false, children}) {
  const frame = useCurrentFrame();
  const foreground = dark ? paper : ink;
  return <AbsoluteFill style={{background: dark ? ink : paper, color: foreground}}>
    <div style={{position: "absolute", left: 100, right: 100, top: 52, display: "flex", justifyContent: "space-between", alignItems: "center"}}>
      <Wordmark dark={!dark} width={185}/>
      <div style={{fontSize: 25, color: dark ? lime : "#545d4a", fontWeight: 550, letterSpacing: 2}}>{section}</div>
    </div>
    <h2 style={{margin: 0, position: "absolute", top: 111, left: 96, fontWeight: 630, fontSize: 76, letterSpacing: -3, ...enter(frame, 19)}}>{title}</h2>
    {children}
  </AbsoluteFill>;
}

function Screen({x = 96, y, w = 1728, h, children}) {
  return <div style={{position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 17,
    overflow: "hidden", background: "#1a1b1c", border: "1px solid #53584f"}}>{children}</div>;
}

function Library() {
  return <Chapter title="今天，练自重深蹲。" section="动作库">
    <div style={{position: "absolute", left: 102, top: 254, fontSize: 37, color: "#46503f"}}>搜索「深蹲」，再把器械筛成「自重」。</div>
    <div style={{position: "absolute", left: 100, right: 100, top: 407, display: "flex", gap: 38}}>
      {[
        {label: "动作名称", left: -2015, top: -74, width: 2850},
        {label: "器械筛选", left: -22, top: -248, width: 2390},
      ].map(({label, left, top, width}) => <div key={label} style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 29, color: "#58634e", marginBottom: 21}}>{label}</div>
        <div style={{position: "relative", height: 277, background: "#191b1c", borderRadius: 16, overflow: "hidden"}}>
          <Footage name="library" style={{position: "absolute", left, top, width, height: "auto"}}/>
        </div>
      </div>)}
    </div>
  </Chapter>;
}

function Plan() {
  const frame = useCurrentFrame();
  const zoom = interpolate(frame, [0, 37, 88], [1.83, 1.83, 1], {
    extrapolateRight: "clamp", easing: Easing.inOut(Easing.cubic),
  });
  return <Chapter title="把这组目标改为 3 次。" section="训练计划" dark>
    <Screen x={126} w={1668} y={242} h={794}><Footage name="plan" style={{transformOrigin: "37% 34%", transform: `scale(${zoom})`}}/></Screen>
  </Chapter>;
}

function Count() {
  return <Chapter title="回到站姿，次数加一。" section="自动计次  /  预录动作样本">
    <Screen x={200} y={218} w={1520} h={856}><Footage name="count" from={18}/></Screen>
  </Chapter>;
}

function History() {
  const frame = useCurrentFrame();
  return <Chapter title="这组深蹲，已经存好了。" section="训练记录" dark>
    <div style={{position: "absolute", left: 105, top: 263, color: lime, display: "flex", gap: 55,
      alignItems: "baseline", ...enter(frame - 5), fontVariantNumeric: "tabular-nums"}}>
      <span style={{fontSize: 130, lineHeight: 1.1, fontWeight: 550}}>1<span style={{fontSize: 46, marginLeft: 14}}>组</span></span>
      <span style={{fontSize: 130, lineHeight: 1.1, fontWeight: 550}}>3<span style={{fontSize: 46, marginLeft: 14}}>次</span></span>
    </div>
    <Screen y={469} h={456}><Footage name="history"/></Screen>
  </Chapter>;
}

const scenes = [
  {start: 0, end: 3, component: Intro}, {start: 3, end: 8, component: Library},
  {start: 8, end: 13, component: Plan}, {start: 13, end: 25, component: Count},
  {start: 25, end: 31, component: History},
];

function Tour() {
  return <AbsoluteFill style={{fontFamily: font, background: ink}}>
    {scenes.map(({start, end, component: Scene}) =>
      <Sequence key={start} from={start * fps} durationInFrames={(end - start) * fps}><Scene/></Sequence>)}
  </AbsoluteFill>;
}

registerRoot(() => <Composition id="OpenFitnessTour" component={Tour}
  width={1920} height={1080} fps={fps} durationInFrames={31 * fps}/>);
