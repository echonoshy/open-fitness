import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, Search, X } from "lucide-react";
import {
  filterMovements,
  movementCapability,
  movementLevels,
  movementMuscles,
  primaryMovementSlugs,
  type Movement,
} from "../core/movement-library";
import { MovementFilters, type MovementFacets } from "./MovementFilters";
import type { LibrarySource } from "./MovementLibrary";

type PickerMode =
  | { mode: "plan"; onSelect: (item: Movement) => void }
  | {
      mode: "home";
      shortcuts: string[];
      onSave: (slugs: string[]) => Promise<void>;
    };

export function MovementPicker(
  props: LibrarySource &
    PickerMode & { favorites: string[]; onClose: () => void },
) {
  const { items, favorites, failed, reload, onClose } = props;
  const managing = props.mode === "home";
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [facets, setFacets] = useState<MovementFacets>({});
  const [limit, setLimit] = useState(32);
  const [draft, setDraft] = useState<string[]>(() =>
    managing ? props.shortcuts.slice() : [],
  );
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    const node = dialog.current!;
    node.showModal();
    return () => node.close();
  }, []);
  const results = useMemo(() => {
    const order = new Map(
      (selectedOnly ? draft : favorites).map((s, i) => [s, i]),
    );
    const source = selectedOnly
      ? items.filter((m) => order.has(m.slug))
      : items;
    const found = filterMovements(source, { ...facets, query });
    return found.sort(
      (a, b) =>
        (order.get(a.slug) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.slug) ?? Number.MAX_SAFE_INTEGER),
    );
  }, [items, favorites, query, facets, draft, selectedOnly]);
  const resetFilters = () => {
    setFacets({});
    setQuery("");
    setLimit(32);
  };
  const choose = (item: Movement) => {
    if (props.mode === "plan") props.onSelect(item);
    else
      setDraft((old) =>
        old.includes(item.slug)
          ? old.filter((s) => s !== item.slug)
          : [...old, item.slug],
      );
  };
  const move = (slug: string, step: number) =>
    setDraft((old) => {
      const i = old.indexOf(slug),
        j = i + step;
      if (i < 0 || j < 0 || j >= old.length) return old;
      const next = old.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const save = async () => {
    if (props.mode !== "home" || saving) return;
    setSaving(true);
    setError("");
    try {
      await props.onSave(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "快捷动作保存失败，请重试。");
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="plan-picker"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!saving) onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current && !saving) onClose();
      }}
    >
      <div className="plan-picker-body">
        <header>
          <div>
            <h2 id={titleId}>
              {managing ? "管理首页快捷动作" : "选择计划动作"}
            </h2>
            <p>
              {managing
                ? "勾选常用动作，在「首页已选」里调整顺序。"
                : "按难度、肌群和器械浏览，点选动作即可加入计划。"}
            </p>
          </div>
          <button aria-label="关闭动作选择" disabled={saving} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <div className="picker-layout">
          <aside className="picker-filters" aria-label="动作分类">
            <MovementFilters
              items={items}
              value={facets}
              onChange={(v) => {
                setFacets(v);
                setLimit(32);
              }}
            />
          </aside>
          <section className="picker-catalog" aria-label="可选动作">
            <label className="library-search">
              <Search size={18} />
              <input
                aria-label="搜索全部动作"
                placeholder="也可搜索动作名称"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(32);
                }}
              />
            </label>
            {managing && (
              <div className="picker-tabs" aria-label="快捷动作范围">
                {[false, true].map((only) => (
                  <button
                    key={String(only)}
                    aria-pressed={selectedOnly === only}
                    onClick={() => {
                      setSelectedOnly(only);
                      resetFilters();
                    }}
                  >
                    {only ? `首页已选 · ${draft.length}` : "全部动作"}
                  </button>
                ))}
              </div>
            )}
            <p className="picker-count" role="status">
              {results.length} 个动作{!selectedOnly && " · 常练优先"}
            </p>
            <div
              className="plan-picker-scroll"
              key={[
                query,
                facets.level,
                facets.muscle,
                facets.equipment,
                selectedOnly,
              ].join("|")}
            >
              {failed ? (
                <button onClick={reload}>动作库读取失败，重新加载</button>
              ) : !items.length ? (
                <p>正在读取动作…</p>
              ) : !results.length ? (
                <div className="picker-empty">
                  <p>
                    {selectedOnly && !draft.length
                      ? "还没有首页快捷动作，请到「全部动作」选择。"
                      : "没有符合条件的动作。"}
                  </p>
                  {(query || Object.values(facets).some(Boolean)) && (
                    <button onClick={resetFilters}>清除筛选</button>
                  )}
                </div>
              ) : (
                results.slice(0, limit).map((m) => {
                  const chosen = draft.includes(m.slug);
                  return (
                    <article className="picker-entry" key={m.slug}>
                      <button
                        className="plan-picker-item"
                        type="button"
                        onClick={() => choose(m)}
                        disabled={saving}
                        aria-pressed={managing ? chosen : undefined}
                      >
                        <img src={m.poster} alt="" loading="lazy" />
                        <span>
                          <strong>{m.name}</strong>
                          <small>
                            {movementLevels[m.level] ?? m.level} ·{" "}
                            {m.primaryMuscles
                              .map((s) => movementMuscles[s] ?? s)
                              .join(" / ")}
                          </small>
                          <small>
                            {movementCapability(m)}
                            {favorites.includes(m.slug) && " · 常练"}
                          </small>
                        </span>
                        {managing &&
                          (chosen ? <Check size={16} /> : <Plus size={16} />)}
                      </button>
                      {selectedOnly && (
                        <div className="shortcut-order">
                          <button
                            aria-label={`上移${m.name}`}
                            disabled={saving || m.slug === draft[0]}
                            onClick={() => move(m.slug, -1)}
                          >
                            <ArrowUp size={14} />
                          </button>
                          <button
                            aria-label={`下移${m.name}`}
                            disabled={saving || m.slug === draft.at(-1)}
                            onClick={() => move(m.slug, 1)}
                          >
                            <ArrowDown size={14} />
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })
              )}
              {limit < results.length && (
                <button
                  className="load-more"
                  onClick={() => setLimit(limit + 32)}
                >
                  查看更多动作
                </button>
              )}
            </div>
          </section>
        </div>
        {managing && (
          <footer>
            <button
              disabled={saving}
              onClick={() => {
                setDraft(Object.values(primaryMovementSlugs));
                setSelectedOnly(true);
                resetFilters();
              }}
            >
              恢复默认九项
            </button>
            {error && <span role="alert">{error}</span>}
            <button
              className="save-shortcuts"
              disabled={saving || failed || !items.length}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : `保存快捷动作（${draft.length}）`}
            </button>
          </footer>
        )}
      </div>
    </dialog>
  );
}
