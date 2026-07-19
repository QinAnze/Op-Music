# Op Music

一款用 Rust + Tauri 构建的极简本地音乐播放器，Serif · Monochrome · Borderless 设计风格。

![截图](assets/gh-page.png)

## 功能

- **本地音乐库** — 递归扫描文件夹，支持 MP3 / FLAC / WAV / OGG / M4A / AAC / WMA / Opus / AIFF
- **元数据与封面** — 读取 ID3v2 / Vorbis Comments / MP4 标签，显示内嵌专辑封面
- **歌单** — 每个文件夹自动生成一个歌单；所有已添加的目录在重启后自动恢复
- **收藏夹** — 基于文件路径，重启不丢失，启动时自动校验文件是否存在
- **魔法书词云** — 解析 LRC 文件或内嵌歌词，分词后以随机大小、颜色、横竖方向填满整页，不重叠
- **实时频谱** — Web Audio API 可视化，条带颜色跟随配色方案
- **双皮肤** — 浅色（暖白+黑）和蓝色（`#2f55cb`+白），一键切换
- **配色方案** — Bridge / Stellar / Hypr / Rdm / Cover（从专辑封面提取调色板）/ Default
- **开机自启** — Windows 注册表方式，设置面板中开关
- **ZIP 导出** — 一键将收藏夹歌曲打包为 ZIP 归档
- **键盘快捷键** — 空格（播放/暂停）、Ctrl+←→（上一首/下一首）、Ctrl+K（搜索）

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面壳 | Tauri v2 |
| 后端 | Rust — `lofty`（元数据）、`walkdir`（扫描）、`zip`（导出） |
| 前端 | HTML5 + CSS3 + 原生 JavaScript |
| 音频 | HTML Audio 元素（base64 data URL） |
| 可视化 | Web Audio API AnalyserNode |
| 样式 | CSS 自定义属性，零第三方依赖 |

## 快速开始

releases内下载安装程序双击安装或下载压缩包解压后双击.exe即可使用。目前仅支持Windows端。

或：

```bash
cd src-tauri
cargo run
```

## 项目结构

```
opmusic-ds/
├── dist/                  # 前端（Tauri 加载）
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── src-tauri/             # Rust 后端
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── scanner.rs     # 目录扫描 + 元数据读取
│   │   └── commands.rs    # Tauri IPC 命令
│   ├── Cargo.toml
│   └── tauri.conf.json
├── assets/                # 图标、设计文档、设计令牌
└── README.md
```

## 构建发布


```bash
cargo install tauri-cli
cargo tauri build
# 输出: src-tauri/target/release/bundle/
```

## 许可

MIT
