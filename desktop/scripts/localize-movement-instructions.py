"""Draft Chinese exercise copy from the cached public catalogue for editorial review.

Uses the project's configured text service. Per-batch caches make this resumable;
no credentials or service responses are printed. Nothing is generated at runtime.
"""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import hashlib
import json
import re
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "output/movement-library-update-20261102/copy-cache"
CACHE.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / "data/movekit-library.json"
TARGET = ROOT / "data/movekit-library.instructions.zh-CN.json"
CONFIG = json.loads((ROOT / "desktop/config/services.defaults.json").read_text())["llm"]
NAMES = json.loads((ROOT / "data/movekit-library.zh-CN.json").read_text())["names"]
PROMPT = """你是健身动作中文编辑。仅根据提供的每个动作资料，输出简体中文 JSON 对象，键是原 slug，值是 {\"description\":\"...\",\"instructions\":[\"...\",...] }。
description 是 1-2 句简洁的动作介绍：训练部位与动作特点。剔除营销、应用开发、资产销售等语言，不夸大效果，不承诺康复或治疗。
instructions 是 4-6 条具体且简洁的动作要领，按准备姿势、动作路径、控制与还原的顺序；忠实保留原资料中的特殊姿势、握法、单侧/交替、器械区别、训练方向。使用自然中文，不生硬逐词翻译，不用每个动作相同的通用建议填充。保持关节在舒适范围，不鼓励忍痛、憋气、猛拉颈部或过度伸展。动作本身就是爆发、跳跃、静态、活动度或伸展时必须正确区分。不得编造负荷、次数、训练计划或替换动作。
每条只写文字，不加编号、Markdown 或小标题。完整覆盖输入 slug，不添加其他键。"""


def translate(rows):
    payload = [{"slug": x["slug"], "name": NAMES[x["slug"]],
                "originalName": x["name"], "description": x["shortDescription"],
                "instructions": x["instructions"], "commonMistakes": x["commonMistakes"],
                "primaryMuscles": x["primaryMuscles"]} for x in rows]
    digest = hashlib.sha256((PROMPT + json.dumps(payload)).encode()).hexdigest()
    cache = CACHE / (digest + ".json")
    if cache.exists():
        return json.loads(cache.read_text())
    for attempt in range(4):
        try:
            body = {"model": CONFIG["model"], "store": False, "stream": False,
                    "max_output_tokens": 8500, "temperature": 0.15,
                    "input": [{"role": "system", "content": PROMPT},
                              {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
                    **({"thinking": {"type": "disabled"}} if CONFIG.get("provider") == "volcengine"
                       else {"chat_template_kwargs": {"enable_thinking": False}})}
            headers = {"Content-Type": "application/json"}
            if CONFIG.get("apiKey"):
                headers["Authorization"] = "Bearer " + CONFIG["apiKey"]
            request = urllib.request.Request(CONFIG["baseUrl"] + "/responses",
                data=json.dumps(body).encode(), headers=headers)
            with urllib.request.urlopen(request, timeout=240) as response:
                result = json.load(response)
            text = "".join(c.get("text", "") for o in result.get("output", [])
                           for c in o.get("content", []) if c.get("type") == "output_text")
            if not text:
                text = result.get("output_text", "")
            data = json.loads(text[text.index("{"):text.rindex("}") + 1])
            assert set(data) == {x["slug"] for x in rows}, "slug coverage"
            for slug, item in data.items():
                assert set(item) == {"description", "instructions"}, slug
                assert isinstance(item["description"], str) and re.search(r"[\u4e00-\u9fff]", item["description"]), slug
                assert 4 <= len(item["instructions"]) <= 6, slug
                assert all(isinstance(s, str) and re.search(r"[\u4e00-\u9fff]", s) for s in item["instructions"]), slug
            cache.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
            return data
        except Exception as error:
            if attempt == 3:
                raise RuntimeError(f"Could not translate {rows[0]['slug']}: {type(error).__name__}") from None
            time.sleep(attempt + 1)


if __name__ == "__main__":
    rows = json.loads(SOURCE.read_text())["exercises"]
    result = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(translate, rows[i:i + 10]) for i in range(0, len(rows), 10)]
        for future in as_completed(futures):
            result.update(future.result())
            print(f"Chinese copy: {len(result)}/{len(rows)}", flush=True)
    TARGET.write_text(json.dumps({"language": "zh-CN", "source": "movekit-library.json",
        "movements": {x["slug"]: result[x["slug"]] for x in rows}}, ensure_ascii=False, indent=2) + "\n")
    print(f"Saved {len(result)} descriptions and instruction lists.", flush=True)
