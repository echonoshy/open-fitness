import { MovementFilters, type MovementFacets } from "./MovementFilters";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronDown,
  Dumbbell,
  Play,
  Plus,
  Check,
  Search,
  X,
} from "lucide-react";
import {
  filterMovements,
  movementEquipment,
  movementLevels,
  movementMuscles,
  type Movement,
} from "../core/movement-library";
import { EmptyState, PageHeading, TabNavigation } from "./FeatureUI";
import "./movement-library.css";
import { MovementPlayer } from "./MovementPlayer";

const BATCH = 24;
const labels = (values: string[], dictionary: Record<string, string>) =>
  values.map((value) => dictionary[value] ?? value).join(" / ");

type LibrarySource = {
  items: Movement[];
  failed: boolean;
  reload: () => void;
};
export type { LibrarySource };

export function LibraryPanel({
  items,
  failed,
  reload,
  savedMovements,
  onFavorite,
  report,
  ready,
}: LibrarySource & {
  savedMovements: string[];
  onFavorite: (item: Movement, save: boolean) => Promise<void>;
  report: (error: unknown) => void;
  ready: boolean;
}) {
  const [facets,setFacets] = useState<MovementFacets>({});
  const filtering = Object.values(facets).some(Boolean);
  const [tab, setTab] = useState("favorites");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(BATCH);
  const [selected, setSelected] = useState<Movement | null>(null);
  const [saving, setSaving] = useState("");
  const favorites = tab === "favorites";
  const results = useMemo(() => {
    const bySlug = new Map(items.map((m) => [m.slug, m]));
    const source = favorites
      ? savedMovements.flatMap((slug) => bySlug.get(slug) ?? [])
      : items;
    return filterMovements(source, { ...facets, query });
  }, [items, savedMovements, favorites, query, facets]);
  const toggle = async (item: Movement) => {
    if (!ready || saving) return;
    const save = !savedMovements.includes(item.slug);
    setSaving(item.slug);
    try {
      await onFavorite(item, save);
      if (favorites && !save && selected?.slug === item.slug) setSelected(null);
    } catch (error) {
      report(error);
    } finally {
      setSaving("");
    }
  };
  const changeTab = (value: string) => {
    setTab(value);
    setFacets({});
    setQuery("");
    setLimit(BATCH);
  };
  const index = selected
    ? results.findIndex((m) => m.slug === selected.slug)
    : -1;
  return (
    <main className="feature-page movement-library">
      <PageHeading title="动作库" sub="MoveKit 动作演示与封面 · 仅供内部参考" />
      <div className="movement-toolbar">
        <TabNavigation
          label="动作库内容"
          value={tab}
          onChange={changeTab}
          items={[
            ["favorites", "常练动作"],
            ["all", "全部动作"],
          ]}
        />
        <label className="library-search">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="搜索动作视频"
            placeholder={favorites ? "搜索常练动作" : "搜索动作、器械或肌群"}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(BATCH);
            }}
          />
        </label>
      </div>
      <MovementFilters items={items} value={facets} onChange={v=>{setFacets(v);setLimit(BATCH);}}/>
      <p className="movement-result-count" role="status">
        {favorites ? "常练动作" : "全部动作"} · {results.length} 个
      </p>
      <section className="movement-grid" aria-label="动作视频">
        {failed ? (
          <div className="movement-empty">
            <p>动作视频目录暂时无法读取。</p>
            <button onClick={reload}>重新加载</button>
          </div>
        ) : !items.length ? (
          <div role="status">正在读取动作视频…</div>
        ) : !results.length ? (
          <div className="movement-empty">
            <EmptyState
              icon={BookOpen}
              title={query || filtering ? "没有找到这个动作" : "还没有常练动作"}
              text={
                favorites && !query && !filtering
                  ? "在全部动作里找到喜欢的视频，点「加入常练」就能在这里看到。"
                  : "可减少筛选条件，或换一个动作名称。"
              }
            />
            {(query || filtering) && <button onClick={()=>{setFacets({});setQuery("");setLimit(BATCH);}}>清除筛选</button>}
            {favorites && (
              <button onClick={() => changeTab("all")}>浏览全部动作</button>
            )}
          </div>
        ) : (
          results.slice(0, limit).map((item) => {
            const added = savedMovements.includes(item.slug);
            return (
              <article className="movement-choice" key={item.slug}>
                <MovementCard item={item} onOpen={() => setSelected(item)} />
                <div className="movement-choice-actions">
                  <button
                    className="favorite-toggle" aria-pressed={added}
                    title={added ? "移出常练" : "加入常练"}
                    disabled={!ready || !!saving}
                    onClick={() => void toggle(item)}
                    aria-label={`${added ? "移出常练" : "加入常练"}：${item.name}`}
                  >
                    {added ? <Check size={15} /> : <Plus size={15} />}{" "}
                    {saving === item.slug
                      ? "保存中…"
                      : added
                        ? "已加入常练"
                        : "加入常练"}
                  </button>
                </div>
              </article>
            );
          })
        )}
      </section>
      {results.length > limit && (
        <button className="load-more" onClick={() => setLimit(limit + BATCH)}>
          查看更多动作 <ChevronDown size={16} />
        </button>
      )}
      {selected && (
        <MovementDialog
          item={selected}
          index={index}
          total={results.length}
          filtered={favorites || !!query || filtering}
          onClose={() => setSelected(null)}
          added={savedMovements.includes(selected.slug)}
          saving={!!saving}
          ready={ready}
          onAdd={() => void toggle(selected)}
          onPrevious={
            index > 0 ? () => setSelected(results[index - 1]) : undefined
          }
          onNext={
            index >= 0 && index + 1 < results.length
              ? () => setSelected(results[index + 1])
              : undefined
          }
        />
      )}
    </main>
  );
}

function MovementCard({
  item,
  onOpen,
}: {
  item: Movement;
  onOpen: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <button
      type="button"
      className="movement-card"
      onClick={onOpen}
      aria-label={`观看${item.name}演示`}
    >
      <span className="movement-poster">
        {imageFailed ? (
          <span className="movement-poster-missing">
            <Dumbbell size={36} />
            点击观看视频
          </span>
        ) : (
          <img
            src={item.poster}
            alt={`${item.name}动作图示`}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
          />
        )}
        <span className="movement-play">
          <Play size={21} fill="currentColor" />
        </span>
        <span className="movement-duration">
          {item.durationSeconds.toFixed(1)} 秒
        </span>
      </span>
      <span className="movement-card-copy">
        <strong>{item.name}</strong>
        <span className="movement-card-muscles">
          {labels(item.primaryMuscles, movementMuscles)}
        </span>
        <span className="movement-card-meta">
          <span>{labels(item.equipment, movementEquipment)}</span>
          <span className="movement-level">
            {movementLevels[item.level] ?? item.level}
          </span>
        </span>
      </span>
    </button>
  );
}

function MovementDialog({
  item,
  index,
  total,
  filtered,
  onClose,
  onPrevious,
  onNext,
  onAdd,
  added,
  saving,
  ready,
}: {
  item: Movement;
  index: number;
  total: number;
  filtered: boolean;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onAdd: () => void;
  added: boolean;
  saving: boolean;
  ready: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.scrollTo({ top: 0 });
  }, [item.slug]);
  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement;
    element.showModal();
    return () => {
      element.querySelector("video")?.pause();
      element.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="movement-dialog"
      aria-labelledby="movement-title"
      onCancel={(event) => {
        event.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header className="movement-dialog-heading">
        <div>
          <h2 id="movement-title">{item.name}</h2>
          <p>
            {item.originalName}
            {item.videoQuality === "enhanced-720p" && (
              <span
                className="movement-video-quality"
                title="由 360p 素材增强至 720p，保留原帧率和动作时长"
              >
                720p 增强
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭动作演示"
          onClick={onClose}
          autoFocus
        >
          <X size={21} />
        </button>
      </header>
      <div className="movement-dialog-body">
        <div className="movement-dialog-visual">
          <MovementPlayer key={item.slug} item={item} />
          <p className="movement-result-count">演示与封面来自 MoveKit，仅供内部参考。转载或商用须获原权利人授权。</p>
          <div className="movement-dialog-info">
            <div>
              <span>主要肌群</span>
              <strong>{labels(item.primaryMuscles, movementMuscles)}</strong>
            </div>
            {item.secondaryMuscles.length > 0 && (
              <div>
                <span>辅助肌群</span>
                <strong>
                  {labels(item.secondaryMuscles, movementMuscles)}
                </strong>
              </div>
            )}
            <div>
              <span>器械</span>
              <strong>{labels(item.equipment, movementEquipment)}</strong>
            </div>
            <div>
              <span>难度</span>
              <strong>{movementLevels[item.level] ?? item.level}</strong>
            </div>
          </div>
        </div>
        <div className="movement-dialog-copy" key={item.slug}>
          <section aria-labelledby="movement-description-title">
            <h3 id="movement-description-title">动作介绍</h3>
            <p>{item.description}</p>
          </section>
          <section aria-labelledby="movement-instructions-title">
            <h3 id="movement-instructions-title">动作要领</h3>
            <ol>
              {item.instructions.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          </section>
        </div>
      </div>
      <footer className="movement-dialog-footer">
        <div className="movement-practice-actions">
          <button type="button" className="favorite-toggle" aria-pressed={added} onClick={onAdd} disabled={!ready || saving}>
            {added ? <Check size={16} /> : <Plus size={16} />}
            {saving ? "保存中…" : added ? "移出常练" : "加入常练"}
          </button>
        </div>
        <button type="button" onClick={onPrevious} disabled={!onPrevious}>
          <ArrowLeft size={16} />
          上一个
        </button>
        <span>
          {filtered ? "当前筛选" : "全部动作"} · {index + 1} / {total}
        </span>
        <button type="button" onClick={onNext} disabled={!onNext}>
          下一个
          <ArrowRight size={16} />
        </button>
      </footer>
    </dialog>
  );
}
