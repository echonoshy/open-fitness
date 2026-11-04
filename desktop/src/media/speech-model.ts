import * as ort from "onnxruntime-web/wasm";
import { Silero } from "@ricky0123/vad-web/dist/models/silero";
// All runtime/model assets ship with the application; no CDN at microphone start.
export async function speechModel(signal: AbortSignal) {
  ort.env.wasm.wasmPaths = new URL("./vad/", document.baseURI).href;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  ort.env.logLevel = "error";
  return Silero.new(ort, async () => {
    const response = await fetch(
      new URL("./vad/silero_vad_v5.onnx", document.baseURI),
      { signal },
    );
    if (!response.ok) throw Error("人声检测模型读取失败");
    return response.arrayBuffer();
  });
}
