import { useUiLocale } from "../i18n";
type Point = readonly [number, number];
export interface CameraGuide {
  title: string;
  detail: string;
  description?: string;
  cameraY: number;
  head: Point;
  body: string;
  limbs: string;
  joints: readonly Point[];
  equipment?: string;
  ground?: boolean;
}

export function CameraPlacementGuide({
  name,
  guide,
}: {
  name: string;
  guide: CameraGuide;
}) {
  const { uiText } = useUiLocale();
  const tripodBase = Math.min(29, 82 - guide.cameraY);
  return (
    <div className="exercise-guide" aria-label={uiText(`${name}拍摄引导`)}>
      <svg
        className="exercise-guide-diagram"
        viewBox="0 0 128 80"
        role="img"
        aria-label={uiText(guide.description ?? `${guide.title}。${guide.detail}`)}
      >
        <g transform={`translate(0 ${guide.cameraY - 6})`}>
          <rect x="4" y="0" width="15" height="12" rx="2.5" />
          <path d={`M19 4L27 0V12L19 8M11.5 12V${tripodBase}M5 ${tripodBase}H18M34 6H47L43 2M47 6L43 10`} />
        </g>
        {guide.ground !== false && (
          <path d="M53 76H123" className="guide-equipment" />
        )}
        {guide.equipment && (
          <path d={guide.equipment} className="guide-equipment" />
        )}
        <circle cx={guide.head[0]} cy={guide.head[1]} r="5.5" />
        <path d={guide.body} />
        <path d={guide.limbs} />
        {guide.joints.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.8" className="guide-joint" />
        ))}
      </svg>
      <div className="exercise-guide-copy">
        <strong>{uiText(guide.title)}</strong>
        <small>{uiText(guide.detail)}</small>
      </div>
    </div>
  );
}
