# Kuina Tech

**Kuina Tech** の1ページ静的サイト（ほぼ純HTML＋ゼロ依存ビルド構成）。  
`games/` にゲームを1フォルダずつ追加し、`src/data/games.json` に登録するだけで `Game Center` へ自動公開されます。

## フォルダ構成

```text
├── games/                  # ブラウザゲーム本体（1ゲーム = 1フォルダ）
│   └── meiro5sec/          # 5秒迷路 (MEIRO 5SEC)
├── src/                    # Kuina Tech ポータル本体のソース
│   ├── data/games.json     # Game Center のゲーム一覧データ
│   ├── pages/              # index.html / 404.html
│   ├── partials/           # head / header / footer
│   ├── styles/             # tokens / base / components
│   └── scripts/            # portal.js
├── scripts/
│   ├── build.ps1           # Windows PowerShell 静的ビルドツール
│   ├── dev.ps1             # ローカル開発サーバー（src/ と games/ を自動監視）
│   └── build.mjs           # Node.js / CI 用ビルドスクリプト
└── dist/                   # ビルド出力（そのまま公開可能）
```

## ビルド＆ローカル確認（Windows PowerShell・Node不要）

```powershell
# 静的ビルド（dist/ へ出力）
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1

# ローカル開発サーバー起動（http://localhost:4173・保存時自動リビルド）
powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1
```

## Node.js / CI ビルド（Cloudflare Pages / GitHub Pages 等）

```bash
npm run build
# 出力ディレクトリ: dist
```

## 新作ゲームの追加方法
1. `games/<ゲーム名>/` フォルダを作り、`index.html` などを配置します（画像や音声フォルダもそのまま置けます）。
2. `src/data/games.json` の `games` に1件追加します（`"bundle": { "sourceDir": "games/<ゲーム名>" }` だけでフォルダ丸ごと自動コピーされます）。
3. `.\scripts\build.ps1`（または `npm run build`）を実行すると `Game Center` と `dist/games/<ゲーム名>/` が自動生成されます。
