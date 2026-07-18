# Op Music — Design System

## Philosophy

**Serif · Monochrome · Borderless** — an editorial, magazine-like aesthetic with zero
border-radius, sharp corners, and a restrained two-theme color system.

## Color Palette

### Light (default)

| Token       | Hex       | Role |
|-------------|-----------|------|
| `--bg`      | `#fafaf9` | Page background |
| `--surface` | `#ffffff` | Cards, buttons, sidebar, player bar |
| `--surface-2`| `#f5f5f4` | Hover states, search box, card art |
| `--text`    | `#1c1917` | Primary text |
| `--text-2`  | `#78716c` | Secondary text, icons |
| `--text-3`  | `#a8a29e` | Tertiary text, placeholders |
| `--accent`  | `#1c1917` | Progress bar, highlight |
| `--divider` | `#e7e5e4` | Borders, progress track |

### Blue

| Token       | Hex       |
|-------------|-----------|
| `--bg`      | `#2f55cb` |
| `--surface` | `#365ecf` |
| `--surface-2`| `#2a4db8` |
| `--text` — `--accent` | `#ffffff` with alpha variants |

## Typography

### Font Stack

```
Primary:   Georgia → Noto Serif SC → Source Han Serif SC → SimSun → serif
Monospace: SF Mono → Consolas → Monaco → monospace
Script:    Edwardian Script ITC → Palace Script MT → Script MT Bold
           → Segoe Script → Brush Script MT → cursive
```

### Sizes

| Element | Size |
|---------|------|
| Body | 14px |
| Hero title | 38px |
| Section title | 24px |
| Logo ASCII | 9px monospace |
| Logo "Música by Robin" | 30px script |
| Song title | 14px / 600 |
| Artist, Album | 13px |
| Duration, Meta | 11-13px |

## Layout

```
┌──────────┬─────────────────────────────────────┐
│ Sidebar  │  Main                               │
│ 240px    │  ┌──────────────────────────────┐   │
│          │  │ Topbar (search + actions)    │   │
│  ASCII   │  ├──────────────────────────────┤   │
│  Música  │  │                              │   │
│  ──────  │  │ View (discover/search/lib)   │   │
│  主页    │  │                              │   │
│  搜索    │  │                              │   │
│  音乐库  │  │                              │   │
│  ──────  │  └──────────────────────────────┘   │
│  歌单    ├─────────────────────────────────────┤
│  ♥ 收藏  │  Player Bar (68px)                   │
│  全部歌曲 │  ┌──────┬──────────┬──────────────┐ │
│  歌单1   │  │ Art  │ Controls │ Vol / Extra  │ │
│  ...     │  └──────┴──────────┴──────────────┘ │
└──────────┴─────────────────────────────────────┘
```

## Song List Grid

```
Columns: 40px | 3fr | 2fr | 2fr | 60px
         #      Song  Artist Album Dur
```

## Icons

All icons are inline SVG (24×24 viewBox) colored via `currentColor`.
No external icon library dependency.

## Spectrum Visualizer

- Canvas-based bar chart, 32 frequency bins
- Reads from `Web Audio API AnalyserNode` when audio is playing
- Falls back to a procedural BPM-driven simulation (128 BPM kick+snare+hihat)
- Bar color follows `--accent` CSS variable
