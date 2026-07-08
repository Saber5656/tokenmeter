# tokenmeter 設計書 (v1)

- Repository: `github.com/Saber5656/tokenmeter`
- Tagline: "Local-first token & context observability for AI agents."
- License: MIT（前提）/ クラウド送信なし / 個人 OSS・最小実装で早期リリース
- 作成日: 2026-07-08

---

## 1. コンセプトと既存ツールとの位置づけ

tokenmeter は、ローカルで動く AI コーディングエージェント（Claude Code / Codex CLI）のセッションログを **read-only** で解析し、トークン使用量・コスト・context window の状態を横断的に観測する CLI である。

4 つの構想リポジトリ（tokenmeter / tokenhp / tokenlens / memviz）の統合プロダクトであり、1 つの計測コアの上に 4 つのビューを載せる:

| ビュー | 問い | 由来 |
|---|---|---|
| `meter` | いくら使ったか（エージェント・モデル・期間別） | tokenmeter |
| `hp` | あとどれだけ使えるか（予算残量） | tokenhp |
| `lens` | なぜこんなに使うのか（内訳と削減案） | tokenlens |
| `viz` | context に何が居て、何が押し出されるか | memviz |

**既存ツールとの差別化（車輪の再発明にならない位置づけ）**

| 既存 | 範囲 | tokenmeter との違い |
|---|---|---|
| `ccusage/ccusage`（★16.9k） | Claude Code 系のコスト集計 CLI の事実上の標準 | tokenmeter は Claude Code + Codex を**ネイティブ横断**し、コスト（量）に加えて context window（質）を観測する |
| `cobra91/better-ccusage`（★74） | ccusage の multi-provider fork | 集計止まり。内訳分析・削減提案・予算 HP・eviction 可視化はない |
| `HduSy/tokenscope`（★216） | Claude CLI 専用メニューバーダッシュボード | GUI 常駐。tokenmeter は CLI/TUI で、statusline 連携の 1 行出力を持つ |
| `zhangferry/tokendash`（★34） | 複数エージェントログの GUI ダッシュボード | 同上（見る場所が増える）。tokenmeter はターミナルから出ない |
| `yaswanthme007/tokenscope`（★10） | セッションログの token profiler（内訳・削減提案） | profiler 単機能。tokenmeter は常用メーター・予算アラート・ライブ context 可視化まで一体 |

つまり「**集計 CLI（ccusage 系）と profiler（tokenscope 系）が別々に存在する領域を、1 つの local-first CLI に統合し、さらに context window のライブ観測という誰もやっていない軸を足す**」ことが存在理由。

コンセプトの芯は 2 つ:

1. **Local-first**: エージェントが残すローカルログだけを読む。ネットワーク送信ゼロ、API プロキシ設定も不要。インストールした瞬間に過去の履歴まで見える
2. **量と質の両方**: 「いくら使ったか」（meter/hp）と「何に使ったか・何が context に居るか」（lens/viz）を同じデータ基盤で提供する

---

## 2. v1 スコープ

| 区分 | 項目 | 備考 |
|---|---|---|
| 入れる | Claude Code adapter | `~/.claude/projects/**/*.jsonl` の usage を parse（実データで形式確認済み、§9） |
| 入れる | Codex CLI adapter | `~/.codex/sessions/**/rollout-*.jsonl` の `total_token_usage` を parse（同上） |
| 入れる | 統一 UsageEvent モデル + ローカルストア | incremental scan（カーソル方式）で再実行が速い |
| 入れる | 料金表とコスト換算 | 同梱 `pricing.json` + LiteLLM 価格データ互換の上書き |
| 入れる | `meter`: 期間・エージェント・モデル別集計、予算アラート | exit code でスクリプト連携可能 |
| 入れる | `hp`: 予算残量 HP ゲージ、ダメージ演出、しきい値警告 | `--watch` ライブ / `--statusline` 1 行出力 |
| 入れる | `lens`: セッション内訳（system/tools/messages/cache）と削減提案 | ヒューリスティックベース |
| 入れる | `viz`: context window 構成のライブ TUI、eviction 表示 | 1 セッション対象 |
| 入れない | クラウド送信・テレメトリ・アカウント | local-first の芯。恒久方針 |
| 入れない | API プロキシ方式の計測 | 設定侵襲が大きい。ログ parse 方式に限定 |
| 入れない | GUI / ブラウザダッシュボード | tokendash 等と競わない。CLI/TUI に徹する |
| 入れない | tokenizer による正確な再計算 | ログの usage 実測値を正とする。lens/viz の block 単位値は文字数ベースの按分近似（§5） |
| 入れない | 予算の強制 enforcement（エージェント停止） | 表示・警告・exit code まで。エージェントを止めない |
| 入れない | 他エージェント adapter（Gemini CLI / OpenCode 等） | adapter interface だけ固定し v2 の口を残す |
| 入れない | チーム集計・共有レポート | 個人利用に集中 |

---

## 3. 対応プラットフォームと優先順位

| 優先度 | 環境 | 判断 | 理由 |
|---|---|---|---|
| 1 (v1) | macOS / Linux + Node.js 20+ | 対応 | 開発者の環境で検証が完結する。対象ユーザー（CLI エージェント利用者）は Node を持っている |
| 2 (v2) | Windows | 保留 | ログパスと ANSI/TUI 挙動の検証コストが「早く出す」に反する。パス抽象だけ v1 から分離しておく |

---

## 4. 技術選定

### 比較

| 候補 | 配布/起動 | TUI・エコシステム | 開発コスト | 判定 |
|---|---|---|---|---|
| **TypeScript + Node.js（採用）** | `npx tokenmeter` で 0 インストール試用。対象ユーザーは全員 Node 保有 | Ink 等の TUI、JSONL 処理の先行実装（ccusage）が同言語で参照できる | 最小。tokenizer を切った（§2）ので TS の速度で困る処理がない | ✅ |
| Rust | 単一バイナリで最速 | ratatui は強いが、配布は brew/cargo で npx より一段重い | 高。この規模の I/O 集計に Rust の利点が薄い | ❌ 過剰 |
| Go | 単一バイナリ | TUI は可、ただし npm 系ユーザーへの導線が弱い | 中 | ❌ |

### 採用スタック

| 層 | 技術 | 理由 |
|---|---|---|
| 言語 | TypeScript 5.x / Node.js 20+ | 上記 |
| CLI | commander | 枯れていて十分 |
| TUI（hp/viz） | ANSI 直書き + log-update 系の最小構成 | Ink(React) は viz で検討。hp はフレームワーク不要の軽さを優先 |
| テスト | vitest + 実ログ形式の fixture | adapter は fixture ベースで回帰を防ぐ |
| ビルド/配布 | tsup + npm publish | `npx tokenmeter` / `npm i -g` |

**デーモンレス方針**: 常駐プロセスを持たない。各実行時にログを incremental scan し、`--watch` はファイル監視で同じ scan を差分駆動する。常駐が要る機能（メニューバー等）は恒久的にスコープ外。

---

## 5. アーキテクチャ

```
~/.claude/projects/**/*.jsonl ──┐ (read-only)
                                ├─ adapters ─→ UsageEvent[] ─→ store (~/.tokenmeter/) ─→ query ─→ views
~/.codex/sessions/**/*.jsonl ───┘                                                          ├─ meter
                                                                                           ├─ hp
                                                                                           ├─ lens
                                                                                           └─ viz
```

### 5.1 Adapter interface（v2 拡張の口）

```ts
interface AgentAdapter {
  id: 'claude-code' | 'codex' | string;
  detect(): boolean;                          // ログディレクトリの存在確認
  scan(cursor?: Cursor): ScanResult;          // 前回位置以降の新規イベントのみ返す
}
interface ScanResult { events: UsageEvent[]; cursor: Cursor; }
```

### 5.2 UsageEvent（統一スキーマ）

```ts
interface UsageEvent {
  ts: string;                 // ISO 8601
  agent: string;              // 'claude-code' | 'codex'
  model: string;              // ログの実モデル名を正規化せず保持 + 正規化名を別フィールド
  sessionId: string;
  project?: string;           // Claude Code の project slug 等
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;    // Codex: cached_input_tokens / Claude: cache_read_input_tokens
  cacheWriteTokens: number;   // Claude: cache_creation_input_tokens / Codex: なし → 0
  costUsd?: number;           // 料金表から算出。単価不明モデルは undefined のまま集計時に「未計上」表示
}
```

注意点（実ログ確認より）:

- Claude Code は assistant メッセージごとに `message.usage` を持つ（差分値）。`server_tool_use` 等の追加フィールドは v1 では無視
- Codex の `total_token_usage` は**累積値**の可能性が高い。イベント間の差分化を adapter 内で行い、`reasoning_output_tokens` は outputTokens に含まれるかを Spike（Issue #3）で確定する

### 5.3 ContextSnapshot（lens / viz 用）

```ts
interface ContextBlock {
  kind: 'system' | 'tools' | 'user' | 'assistant' | 'tool_result' | 'attachment';
  label: string;              // 例: 'Read: src/app.ts', 'system prompt'
  approxTokens: number;       // 按分近似（下記）
}
```

**token 按分方式**: ブロック単位の正確な token 数はログに無い。各ブロックの文字数比で、そのターンの実測 `inputTokens` 合計を按分する。「実測合計は正確・内訳は近似」と UI に明示し、tokenizer 依存を持たない（§2 の判断）。

### 5.4 ストア

- `~/.tokenmeter/` に append-only JSONL + adapter ごとの cursor ファイル（scan 済みファイルの mtime/size/offset）
- SQLite は v1 では採用しない。ccusage が生 JSONL 再 scan で実用速度を出している実績があり、incremental cursor を足せば十分。性能課題が出た時点で v2 の検討事項とする
- 料金表: 同梱 `pricing.json`（主要モデルの USD 単価: input / output / cache read / cache write）。`--pricing <path|url>` で LiteLLM `model_prices_and_context_window.json` 互換データに差し替え可能

---

## 6. UI/UX

### 6.1 `tokenmeter`（= `tokenmeter meter`）

```
$ tokenmeter                 # 今日の集計（デフォルト）
$ tokenmeter --week --by model
$ tokenmeter --json          # スクリプト連携
```

- 表出力: agent × model × input/output/cache tokens × cost
- `--budget-status`: 予算に対する消費率を表示し、超過時 exit code 2（cron / hook から使える）

### 6.2 `tokenmeter hp`

```
$ tokenmeter hp
 HP ██████████░░░░░░ 62%   $12.4 / $20.0 (today)
$ tokenmeter hp --watch      # ライブ。消費でバーが減り、直近ダメージを演出
$ tokenmeter hp --statusline # 装飾なし 1 行（Claude Code statusline / tmux に埋め込む）
```

- 予算は config の daily/weekly/monthly（USD）。残量% でバー色が緑→黄→赤に遷移し、しきい値割れで警告行
- ダメージ演出: `--watch` 中、新規イベントの cost を `-$0.42` のようにポップ表示（1 行、アニメは控えめに）
- 演出はジョーク由来（tokenhp）だが、`--statusline` は実用の芯。**「常に視界に残量がある」が hp の価値**

### 6.3 `tokenmeter lens [session]`

```
$ tokenmeter lens            # 最新セッション
$ tokenmeter lens --session <id> / --project <slug>
```

- 出力: (1) ブロック種別の内訳バー、(2) トークン消費源 Top N（巨大 tool result、繰り返し添付ファイル、長大 system prompt）、(3) 削減提案
- 削減提案はヒューリスティック（例: 「同一ファイルを N 回添付 → 参照に切替」「tool result が全体の X% → 出力の絞り込み」「cache write が毎ターン発生 → プロンプト先頭の可変要素を疑う」）。LLM は使わない

### 6.4 `tokenmeter viz [session]`

- TUI 全画面。context window を 100% 積み上げバー + ブロックリストで表示し、新規メッセージで更新
- window limit はモデル別テーブル（pricing.json に併載）から取得。limit 接近で警告色
- **eviction 表示**: 実測ではなくログから観測できる範囲（Claude Code の compact イベント等）を「押し出し発生」として表示し、直前スナップショットとの差分で「何が消えたか」を推定表示する。観測できない場合は「limit までの残り」の表示に徹する（誇張しない）

### 6.5 config（`~/.tokenmeter/config.json`）

```json
{
  "budgets": { "daily": 20, "weekly": 100, "monthly": 300 },
  "warnAt": 0.8,
  "currency": "USD"
}
```

---

## 7. 配布方法

| 手段 | 内容 |
|---|---|
| npm | `npx tokenmeter` / `npm i -g tokenmeter`。npm パッケージ名の空きは実装着手時に確認（Issue #4 受け入れ条件） |
| GitHub Releases | tag push で CI が publish。CHANGELOG 自動生成 |
| Homebrew | v2 検討（npx で十分軽いため） |

---

## 8. README 構成案（英語）

```
# tokenmeter ⛽
Local-first token & context observability for AI agents.
[hp gauge の GIF]

## Install        — npx tokenmeter
## What it does   — meter / hp / lens / viz の 4 行 + スクリーンショット
## Why            — ccusage 系（集計）と profiler 系の統合 + context observability
## Privacy        — reads local session logs only; zero network calls
## Supported agents — Claude Code, Codex CLI (adapter interface for more)
## Configuration  — budgets
## License
```

---

## 9. リスクと実装前検証項目

| 優先度 | リスク | 検証・対処 |
|---|---|---|
| P0 | Codex `total_token_usage` の意味論（累積か差分か、`reasoning_output_tokens` の重複計上） | Spike Issue #3 で実ログ複数本から確定。**存在確認は済み**（下記 evidence） |
| P0 | Codex ログからの model 名取得可否 | 同上。取れない場合は session メタ or config 既定値でフォールバック |
| P1 | ブロック按分近似の誤差が lens の説得力を損なう | 「実測合計は正確・内訳は近似」を UI に常時明示。ターン合計と実測の突合テスト |
| P1 | 料金表の陳腐化（新モデル追従） | LiteLLM 互換の外部差し替え口 + 単価不明モデルは「未計上」を明示（黙って $0 にしない） |
| P2 | ログ肥大時の scan 性能 | incremental cursor（§5.4）。ベンチは 10 万イベントで計測 |
| P2 | Claude Code / Codex のログ形式変更 | adapter を fixture テストで固定し、形式変更を CI で検知 |

**実ログ確認済み evidence（2026-07-08, 本設計の根拠）**:

- Claude Code: `~/.claude/projects/<slug>/<uuid>.jsonl` に `"usage":{"input_tokens":7813,"cache_creation_input_tokens":5687,"cache_read_input_tokens":17140,"output_tokens":180,...}` を確認
- Codex: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` に `"total_token_usage":{"input_tokens":15838,"cached_input_tokens":7040,"output_tokens":121,"reasoning_output_tokens":103,"total_tokens":15959}` を確認

---

## 10. v1 Issue 分割案（10 個 / 実 Issue #3–#12）

マイルストーン: **M0 コア（#3–#8）→ M1 meter/hp（#9–#10）→ M2 lens（#11）→ M3 viz（#12）**。§2 の段階リリース方針に対応する。

- **#3 `Spike: confirm usage semantics in Claude Code and Codex session logs`** — ラベル: `spike`, `design`
  実ログ複数本から、Claude Code の usage（差分値・model 名・compact イベントの形）と Codex の `total_token_usage`（累積/差分、reasoning の重複、model 名の所在）を確定し、UsageEvent スキーマを最終化する。
  受け入れ条件: フィールド対応表と差分化ルールを Issue コメントに記録し、fixture 用サンプルログ（マスク済み）を `test/fixtures/` に追加。

- **#4 `Set up CLI scaffold, config loading, and npm packaging`** — ラベル: `infra`
  TypeScript + commander + tsup + vitest の雛形、`~/.tokenmeter/config.json` の読み書き、CI（lint + test）、npm パッケージ名の確保。
  受け入れ条件: `npx tokenmeter --help` がローカル pack から動作し、CI が緑、パッケージ名が確保済み。

- **#5 `Implement usage event store with incremental scan cursors`** — ラベル: `enhancement`
  append-only JSONL ストアと adapter ごとの cursor（mtime/size/offset）。再実行の冪等性を保証する。
  受け入れ条件: 同一ログへの再 scan でイベントが重複しない。10 万イベント再集計 < 2s のベンチを test に含む。

- **#6 `Implement Claude Code adapter`** — ラベル: `enhancement`
  `~/.claude/projects/**/*.jsonl` から UsageEvent への変換。project slug / session / model の抽出を含む。
  受け入れ条件: fixture 入力で期待イベント列に一致。壊れた行・未知フィールドをスキップしても総和が安定。

- **#7 `Implement Codex adapter`** — ラベル: `enhancement`
  `~/.codex/sessions/**/rollout-*.jsonl` から UsageEvent への変換。#3 で確定した差分化ルールを実装する。
  受け入れ条件: fixture 入力で期待イベント列に一致し、累積→差分変換のテストがある。

- **#8 `Add pricing table and cost calculation`** — ラベル: `enhancement`
  同梱 `pricing.json`（cache read/write 単価と context window limit を含む）、`--pricing` での LiteLLM 互換差し替え、単価不明モデルの「未計上」扱い。
  受け入れ条件: 既知モデルのコストが手計算と一致し、未知モデルが $0 ではなく「uncosted」として表示される。

- **#9 `Implement meter view with budgets and alert exit codes`** — ラベル: `enhancement`
  デフォルト集計（today）、`--week/--month/--by agent|model`、`--json`、`--budget-status`（超過で exit 2）。
  受け入れ条件: fixture ストアに対する表出力のスナップショットテスト。予算超過時の exit code をテスト。

- **#10 `Implement hp gauge with watch mode and statusline output`** — ラベル: `enhancement`, `ux`
  HP バー描画（色遷移・しきい値警告）、`--watch`（ファイル監視 + ダメージポップ演出）、`--statusline`（装飾なし 1 行）。
  受け入れ条件: 残量 100/60/20% でバーと色が仕様どおり変わり、`--statusline` 出力が 1 行・ANSI なしで Claude Code statusline に貼れる。

- **#11 `Implement lens breakdown and reduction suggestions`** — ラベル: `enhancement`
  ブロック按分近似（§5.3）、内訳バー、Top N 消費源、ヒューリスティック削減提案 3 種以上。
  受け入れ条件: 按分合計が実測ターン合計と一致（±0 保証）。fixture セッションに対する提案のスナップショットテスト。「内訳は近似」の注記が出力に含まれる。

- **#12 `Implement viz TUI for live context window observation`** — ラベル: `enhancement`, `ux`
  積み上げバー + ブロックリストの TUI、ファイル監視による更新、limit 接近警告、compact/eviction の検知表示（観測できる範囲に限定）。
  受け入れ条件: 進行中セッションを開いて 1 ターン進めるとバーが更新される。limit の 90% 超で警告表示。観測不能ケースで誇張表示しない。

推奨着手順: **#3 → #4 → (#5, #8 並行) → #6 → #7 → #9 → #10 → #11 → #12**。#10（hp）完了時点で最初のリリース（v0.1）を切る。

---

## 参考資料

- ccusage: https://github.com/ccusage/ccusage （JSONL 再 scan 方式の実用性の先行例）
- LiteLLM model prices: https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json （料金表の互換フォーマット）
- 統合の決定録: Agents-Vault `00-Inbox&Tasks/2026-07-07-token-tools-consolidation-decision.md`（競合調査 evidence 含む）
