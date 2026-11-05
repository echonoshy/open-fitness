import React from "react";
import {
  AbsoluteFill, Composition, Easing, Html5Audio, Img, OffthreadVideo, Series,
  interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig,
} from "remotion";

const ink = "#171b19";
const panel = "#232624";
const cream = "#f4f4ed";
const lime = "#d2ed9e";
const font = '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function Screen({name, start = 0, style, videoStyle}) {
  const {fps} = useVideoConfig();
  return <div style={{position: "absolute", left: 133, top: 126, width: 1654, height: 916,
    overflow: "hidden", borderRadius: 16, background: panel, ...style}}>
    <OffthreadVideo src={staticFile(name + ".mp4")} muted trimBefore={Math.round(start * fps)}
      style={{display: "block", width: "100%", height: "100%", objectFit: "cover", ...videoStyle}}/>
  </div>;
}

function Section({title, detail, children}) {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, 9], [0, 1], {
    extrapolateRight: "clamp", easing: Easing.out(Easing.cubic),
  });
  return <AbsoluteFill style={{background: ink, color: cream, fontFamily: font}}>
    <div style={{position: "absolute", top: 35, left: 83, right: 82, height: 69,
      display: "flex", alignItems: "center", gap: 35}}>
      <Img src={staticFile("wordmark.svg")} style={{width: 222}}/>
      <div style={{height: 40, width: 2, background: "#525851"}}/>
      <h1 style={{margin: 0, fontSize: 54, lineHeight: 1.1, letterSpacing: -1,
        fontWeight: 650, transform: `translateY(${(1-progress)*7}px)`}}>{title}</h1>
      <div style={{marginLeft: "auto", fontSize: 30, color: lime}}>{detail}</div>
    </div>
    {children}
  </AbsoluteFill>;
}

function Pose() {
  return <Section title="姿态识别" detail="关节点随动作移动，膝角实时更新">
    <Screen name="count" start={2}/>
  </Section>;
}

function Library() {
  const {fps} = useVideoConfig();
  return <Section title="动作库" detail="浏览动作，打开示范查看肌群与要领">
    <Series>
      <Series.Sequence durationInFrames={7 * fps}>
        <Screen name="library"/>
      </Series.Sequence>
      <Series.Sequence durationInFrames={6 * fps}>
        <Screen name="library-demo" videoStyle={{objectFit:"contain",background:ink}}/>
      </Series.Sequence>
    </Series>
  </Section>;
}

function Plans() {
  const {fps} = useVideoConfig();
  return <Section title="训练计划" detail="安排组数、次数和休息，载入后开始">
    <Series>
      <Series.Sequence durationInFrames={3 * fps}>
        <Screen name="plan" style={{left:89,top:192,width:1742,height:784}}/>
      </Series.Sequence>
      <Series.Sequence durationInFrames={3 * fps}>
        <Screen name="load" start={0.3}/>
      </Series.Sequence>
    </Series>
  </Section>;
}

function Reps() {
  return <Section title="自动计次" detail="俯卧撑下放再推起，计数随回位增加">
    <Screen name="pushup" start={0.4}/>
  </Section>;
}

function Blur() {
  return <Section title="背景虚化" detail="训练中打开「取景」，切换背景效果">
    <Screen name="blur"/>
  </Section>;
}

function Reference() {
  return <Section title="动作参考" detail="边练边看示范，拖动或放大参考窗">
    <Screen name="reference"/>
  </Section>;
}

function Voice() {
  const {fps} = useVideoConfig();
  const frame = useCurrentFrame();
  const answerOpacity = interpolate(frame, [4.4 * fps, 4.72 * fps], [0, 1],
    {extrapolateLeft:"clamp", extrapolateRight:"clamp"});
  const label = {fontSize:30, color:lime, marginBottom:18, fontWeight:580};
  const text = {fontSize:53, margin:0, lineHeight:1.55, letterSpacing:-1};
  return <Section title="AI 语音教练" detail="实机问答转写">
    <div style={{position:"absolute",left:102,top:215,width:900}}>
      <div style={label}>提问</div>
      <p style={text}>做深蹲时摄像头应该从哪个方向拍？请用一句话回答。</p>
      <div style={{marginTop:51,borderTop:"1px solid #4c544a",paddingTop:40,opacity:answerOpacity}}>
        <div style={label}>教练回复</div>
        <p style={text}>深蹲请从侧面或斜前方45度拍摄，让肩、髋、膝、踝完整入镜。</p>
      </div>
    </div>
    <Screen name="conversation" style={{left:1090,top:248,width:720,height:624}}/>
  </Section>;
}

function Guidance() {
  return <Section title="动作讲解" detail="展开教练回复，查看当前动作的要点">
    <Screen name="guide-motion" style={{left:84,top:245,width:932,height:614}}/>
    <Screen name="guide-panel" style={{left:1041,top:245,width:800,height:614}}
      videoStyle={{objectFit:"contain",background:"#262827"}}/>
  </Section>;
}

function History() {
  return <Section title="训练记录" detail="展开一组，回看每次动作的用时和角度">
    <Screen name="history" style={{left:167,top:126,width:1586,height:916}}/>
  </Section>;
}

function Tour() {
  const {fps} = useVideoConfig();
  return <AbsoluteFill style={{background:ink}}>
    <Html5Audio src={staticFile("edm-detection-mode.m4a")}/>
    <Series>
      <Series.Sequence name="姿态识别" durationInFrames={6 * fps}><Pose/></Series.Sequence>
      <Series.Sequence name="动作库" durationInFrames={13 * fps}><Library/></Series.Sequence>
      <Series.Sequence name="训练计划" durationInFrames={6 * fps}><Plans/></Series.Sequence>
      <Series.Sequence name="自动计次" durationInFrames={7 * fps}><Reps/></Series.Sequence>
      <Series.Sequence name="动作参考" durationInFrames={8 * fps}><Reference/></Series.Sequence>
      <Series.Sequence name="背景虚化" durationInFrames={6 * fps}><Blur/></Series.Sequence>
      <Series.Sequence name="AI 语音教练" durationInFrames={10 * fps}><Voice/></Series.Sequence>
      <Series.Sequence name="动作讲解" durationInFrames={6 * fps}><Guidance/></Series.Sequence>
      <Series.Sequence name="训练记录" durationInFrames={6 * fps}><History/></Series.Sequence>
    </Series>
  </AbsoluteFill>;
}

registerRoot(() => <Composition id="OpenFitnessTour" component={Tour}
  width={1920} height={1080} fps={24} durationInFrames={68 * 24}/>);
