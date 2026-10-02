# NOTICE —— 许可分层与署名 / License layering & attribution

`LICENSE`（MIT）**只覆盖本项目的代码**。仓库里还带着美术素材和第三方运行时，它们各自另有条款 ——
这就是这份 NOTICE 存在的原因（放在这里而不是塞进 `LICENSE`，是为了让 GitHub 能正确识别出 MIT）。

`LICENSE` (MIT) **covers the code of this project only**. The repository also ships artwork and third-party
runtimes under their own terms — hence this NOTICE (kept separate from `LICENSE` so that GitHub detects the
MIT license correctly).

---

## 1. 代码 / Code

- **范围 / Scope**：`lib/`、`tools/`、`cordis.patch.yml`、`assets/pet.js`
- **许可 / License**：**MIT**，Copyright © 2026 **Andersen216**（全文见 [`LICENSE`](LICENSE)）

## 2. 美术素材 / Artwork

- **范围 / Scope**：`assets/model/**` —— `*.moc3`、贴图、`*.exp3.json`（表情）、`*.motion3.json`（动作）、
  `model3.json` 等模型相关文件
- **许可 / License**：**[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh)**
  （署名 — **非商业性使用** — 相同方式共享）/ (Attribution — **NonCommercial** — ShareAlike)
- **版权 / Copyright**：**上善无形 / ZipZipPipe / 氵六青** 三位所有，逐项贡献见 [`AUTHORS.md`](AUTHORS.md)，
  逐文件来源与原《使用须知》原文见 [`PROVENANCE.md`](PROVENANCE.md)

## 2.5 表情包 / Sticker pack

- **范围 / Scope**：`assets/stickers/**`（92 张压缩后的 GIF + `manifest.json`）
- **版权 / Copyright**：**赤风RED**（<https://space.bilibili.com/356746604>）——「蓝色大肥鱼」系列表情包的作者
- **许可 / License**：**不适用 MIT，也未套用 CC BY-NC-SA**；使用条款以原作者为准，本项目仅**非商业**随包分发
  / Not MIT, and not CC BY-NC-SA either; terms are the original author's. Distributed here **non-commercially** only.
- **修改说明 / Modifications**：从原 157 张中挑选 92 张，裁掉透明空白边、缩至 96×96、25fps、63 色调色板；
  原图不随仓库分发 / 92 of the original 157 selected, cropped, downscaled to 96×96 at 25fps with a 63-colour palette;
  the originals are not redistributed. See `tools/build-stickers.py`.

## 2.6 音效 / Sound effects

- **范围 / Scope**：`assets/sound/**`（`duck-press.mp3`、`duck-release.mp3`，点击鲸鱼娘时的小黄鸭按下 / 松开音）
- **来源 / Source**：取自 **dsh-whale-widget**（<https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget>）内置的
  「小黄鸭」预设音效 `Ya1.mp3` / `Ya2.mp3`，**逐字节原样、未做任何修改**（仅改了文件名）
  / The preset "rubber duck" sounds bundled with dsh-whale-widget, byte-for-byte unmodified (renamed only).
- **性质 / Nature**：**开源素材，并非本项目或 dsh-whale-widget 作者的原创**（本项目维护者的说明）。
  dsh-whale-widget 自己的 `PROVENANCE.md` 只把它们记为「内置音效」，没有给出原始出处和具体许可；
  所以这里**不写具体许可名**，原始出处与许可待补
  / Open-source material, not original to this project or to dsh-whale-widget (per this project's maintainer).
  dsh-whale-widget's own `PROVENANCE.md` only lists them as bundled sounds without an upstream source or a named
  license, so no specific license is claimed here; the original source and license are **to be confirmed**.
- **许可 / License**：**不适用 MIT**；使用条款以原素材的开源许可为准，本项目仅**非商业**随包分发
  / Not MIT; terms are those of the original open-source asset. Distributed here **non-commercially** only.
- **代码 / Code**：机制（Web Audio 预解码、同步起播、点按时松开音排期到按压音结束前 40ms）参考了 dsh-whale-widget
  （MIT），`assets/app/engine/squeak.js` 为重新实现 / The playback mechanism is modelled on dsh-whale-widget (MIT);
  `assets/app/engine/squeak.js` is a fresh implementation.

## 3. 第三方运行时 / Third-party runtime

| 组件 / Component | 许可 / License | 版权 / Copyright |
| --- | --- | --- |
| Live2D Cubism Core（`assets/vendor/live2dcubismcore.min.js`） | Live2D 专有许可 / Live2D Proprietary License | Live2D Inc. |
| PIXI.js 6.5.10（`assets/vendor/pixi.min.js`） | MIT | PIXI.js contributors |
| pixi-live2d-display 0.4.0（`assets/vendor/cubism4.min.js`） | MIT | pixi-live2d-display contributors |

## 4. 本项目整体是非商业的 / This project is non-commercial

完全免费：**不收费、不带货、不接广告变现、不卖周边、不作为任何付费产品或服务的卖点**。
模型作者的无偿分享与转载授权，**不解除**角色形象本身的 NC / SA 条件。

Entirely free: **no fees, no ads, no merchandise, no sponsorships, and not a selling point of any paid
product or service**. The model authors' kind permission to share and redistribute does **not** waive the
NC / SA conditions attached to the character artwork itself.

---

有任何权利主张 / For any rights claim: 见 [`PROVENANCE.md`](PROVENANCE.md) 末尾的联系方式
（或直接开一个 [Issue](https://github.com/Andersen216/dsh-whale-girl-live2d/issues)）。
