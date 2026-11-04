# open-fitness asset licenses and sources

The noncommercial software license is in [LICENSE](LICENSE). Assets are licensed separately as listed below. For material without a stated license, obtain permission from its rights holder before using or distributing it.

## Original project assets

The original app icon (`desktop/assets/branding/icon.svg` and its PNG and ICNS exports) and original instructions in the Chinese and English README files and `docs/trial-guide.md` use **CC BY-NC 4.0 International**. You may copy, share and adapt them for noncommercial purposes. Credit the creator, include the license link and indicate any changes. Commercial use requires separate permission.

Example attribution: open-fitness contributors, *open-fitness app icon*, CC BY-NC 4.0. Describe any modifications. Source: https://github.com/echonoshy/open-fitness. License: https://creativecommons.org/licenses/by-nc/4.0/.

## Third-party exercise media

Exercise demos, posters and their derivatives belong to their respective rights holders. The project license grants no rights to republish, publicly distribute or commercially use this material.

## Exercise text and training knowledge

- English data in `data/exercises.json` comes from yuhonas/free-exercise-db under the upstream Unlicense public-domain dedication. Existing rights, including commercial use, are retained. Source: https://github.com/yuhonas/free-exercise-db.
- `data/exercises.zh-CN.json` translates this data. Original translation work owned by the project uses CC BY-NC 4.0. The underlying text and exercises retain their own rights status.
- Training notes, baseline data and implementations derived from Feki-Tech/ai-gym-coach appear in `data/knowledge/`. No explicit redistribution license was found in the baseline. The project grants no additional rights in this material. See [project sources](docs/sources.md).

## Voices, models, icon libraries and runtimes

- Prerecorded exercise explanations using eight historical synthetic voices are stored in `desktop/public/exercise-narration/`. One W01 speech sample is retained for interruption detection tests. Permission for standalone redistribution or voice cloning has not been confirmed for these recordings. Volcengine voices used for live previews and coach replies are subject to the provider’s terms. See [voice sources](../voices.md).
- MediaPipe Pose Landmarker, Silero VAD and related WASM files retain their upstream terms. MediaPipe, ONNX Runtime, sql.js, Lucide and other dependencies retain their own licenses, copyrights and attribution. The project’s CC license covers only the original icon identified above.
- The historical Fitness Trainer prototype retains its [MIT license and copyright notice](docs/licenses/fitness-trainer-MIT.txt).

## User data

Camera images, uploaded videos, personal reference movements, workout records and service credentials are controlled by the user. They are outside the scope of the project's asset licenses.
