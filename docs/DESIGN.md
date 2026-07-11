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
| 1 (v1) | macOS / Linux + Node.js >=22.14.0 | 対応 | 開発者の環境で検証が完結する。対象ユーザー（CLI エージェント利用者）は Node を持っている |
| 2 (v2) | Windows | 保留 | ログパスと ANSI/TUI 挙動の検証コストが「早く出す」に反する。パス抽象だけ v1 から分離しておく |

---

## 4. 技術選定

### 比較

| 候補 | 配布/起動 | TUI・エコシステム | 開発コスト | 判定 |
|---|---|---|---|---|
| **TypeScript + Node.js（採用）** | 公開後は `npx @saber5656/tokenmeter` でグローバルインストールなしに試用。対象ユーザーは全員 Node 保有 | Ink 等の TUI、JSONL 処理の先行実装（ccusage）が同言語で参照できる | 最小。tokenizer を切った（§2）ので TS の速度で困る処理がない | ✅ |
| Rust | 単一バイナリで最速 | ratatui は強いが、配布は brew/cargo で npx より一段重い | 高。この規模の I/O 集計に Rust の利点が薄い | ❌ 過剰 |
| Go | 単一バイナリ | TUI は可、ただし npm 系ユーザーへの導線が弱い | 中 | ❌ |

### 採用スタック

| 層 | 技術 | 理由 |
|---|---|---|
| 言語 | TypeScript 5.x / Node.js >=22.14.0 | `package.json` の `engines` と一致。CI は下限 22.14.0 と 24.x で検証 |
| CLI | commander | 枯れていて十分 |
| TUI（hp/viz） | ANSI 直書き + log-update 系の最小構成 | Ink(React) は viz で検討。hp はフレームワーク不要の軽さを優先 |
| テスト | vitest + 実ログ形式の fixture | adapter は fixture ベースで回帰を防ぐ |
| ビルド/配布 | tsup + npm package（publish は別 release gate） | 公開後は `npx @saber5656/tokenmeter` / `npm i -g @saber5656/tokenmeter`。実行 bin は `tokenmeter` |

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
  model: string | null;       // 観測した実モデル名。取得不能時は null（推測・正規化しない）
  sessionId: string;
  project?: string;           // Claude Code の project slug 等
  inputTokens: number;        // cache read/write と重複しない input
  outputTokens: number;       // reasoning_output_tokens を含む
  cacheReadTokens: number;    // inputTokens から分離した cache hit
  cacheWriteTokens: number;   // Claude: cache_creation_input_tokens / Codex: なし → 0
  costUsd?: number;           // 料金表から算出。単価不明モデルは undefined のまま集計時に「未計上」表示
}
```

4カテゴリは非重複とし、表示・合計・料金計算では次だけを足す。

```text
total observed tokens = inputTokens + cacheReadTokens + cacheWriteTokens + outputTokens
```

#### Claude Code の変換規則

| UsageEvent | ログ上の source |
|---|---|
| `ts` | terminal assistant row の `timestamp` |
| `model` | `message.model`。欠落時は `null` |
| `sessionId` | row の `sessionId` |
| `project` | source file の project slug。絶対パスは保持しない |
| `inputTokens` | `message.usage.input_tokens` |
| `outputTokens` | `message.usage.output_tokens` |
| `cacheReadTokens` | `message.usage.cache_read_input_tokens` |
| `cacheWriteTokens` | `message.usage.cache_creation_input_tokens` |

`message.usage` は API response 単位の値だが、JSONL の1行が必ず1 response ではない。同じ call identity に対して streaming snapshot と同一行の再掲があるため、物理 file order で group 化する。

call boundary は adapter cursor が持つ source-file identity と、row 上の `sessionId` / `requestId` / `message.id` / `agentId` / `isSidechain` の組み合わせで判定する。source の絶対パスは UsageEvent に出さない。

1. 同一 group の input/cache/model/request identity が一定で、`output_tokens` が非減少であることを確認する。
2. `stop_reason != null` の terminal snapshot を採用し、同一 terminal row の再掲を dedupe して1件だけ emit する。
3. terminal 未到達 group は cursor state に保留し、中間 snapshot を先に emit しない。
4. counter が非負 safe integer でない、group 内の固定 field が競合する、または terminal output が最大でない group は malformed として skip する。call 内で model/cache が変わる fallback/retry も黙って collapse せず例外扱いにする。
5. unknown field（`server_tool_use` 等）は合計へ加えない。malformed / unknown row は後続 group に影響させない。

Claude Code の compact marker は 2026-07-11 の調査 corpus では構造的に観測できず、形式未確定である。free text、summary、token 数の変化から推測せず、structural evidence が得られるまで compact/eviction event を emit しない。

#### Codex の変換規則

`event_msg.payload.type == "token_count"` の `info.total_token_usage` は session 内の累積 snapshot である。差分・同一性・妥当性の判定には次の4 component だけを使う。

```text
input_tokens
cached_input_tokens     // input_tokens の内数
output_tokens
reasoning_output_tokens // output_tokens の内数
```

`total_tokens` は使用量 component と無関係な一定 offset を含む実例があるため、差分・同一性・validation・合計のすべてで無視し、正規化後の field から再計算する。

| UsageEvent | 累積 snapshot 間の delta からの変換 |
|---|---|
| `ts` | current token-count row の `timestamp` |
| `model` | 同一 session で直前の `turn_context.payload.model`。欠落時は `null` |
| `sessionId` | `session_meta.payload.id` |
| `inputTokens` | `delta.input_tokens - delta.cached_input_tokens` |
| `outputTokens` | `delta.output_tokens`（reasoning を再加算しない） |
| `cacheReadTokens` | `delta.cached_input_tokens` |
| `cacheWriteTokens` | `0` |

snapshot は4 component が非負 safe integer、`cached_input_tokens <= input_tokens`、`reasoning_output_tokens <= output_tokens` のときだけ valid とする。`model_provider` は model 名として使わない。

baseline は source file ではなく stable `sessionId` ごとに保持し、resume で別 rollout file に続いても引き継ぐ。新しい `sessionId` だけが first-sample rule を開始し、`session_meta` の出現だけでは既存 baseline を無条件に捨てない。

1. session の最初の valid snapshot は zero baseline との差分を使う。全 component が0なら emit しない。
2. component が前回と同一なら `total_tokens` / `last_token_usage` が違っても emit しない。
3. 全 component が非減少なら component-wise delta を正規化する。delta 自体が subset 条件を満たさない場合は skip し、baseline を進めない。
4. component が減少したら counter epoch の切替として current を新 baseline にし、その row は emit しない。current 累積値の再掲も `last_token_usage` の代替 emit も行わない。
5. malformed snapshot は skip し、baseline を進めない。未知 event / field は無視する。

`last_token_usage` は component delta の検証と初期 baseline の補助にだけ使う。同一 snapshot の再掲でも値が残り得るため、通常の changed snapshot や reset row の UsageEvent source にしてはならない。

`normalizedModel` は UsageEvent へ追加しない。canonical event には観測した raw model または `null` だけを保存し、pricing/query 層が更新可能な mapping から必要時に派生する。これにより schema と model table の更新周期を分離する。

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
- **eviction 表示**: Claude Code compact の structural shape は未観測で、controlled `/compact` 検証の実施方針は人間判断待ち。shape を確定するまでは推測表示せず「limit までの残り」だけを表示する

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
| npm | package は `@saber5656/tokenmeter`、bin は `tokenmeter`。公開後は `npx @saber5656/tokenmeter` / `npm i -g @saber5656/tokenmeter`。現在は `private: true` で未公開。registry availability の再確認と公開は別 release gate |
| GitHub Releases | tag push で CI が publish。CHANGELOG 自動生成 |
| Homebrew | v2 検討（npx で十分軽いため） |

---

## 8. README 構成案（英語）

```
# tokenmeter ⛽
Local-first token & context observability for AI agents.
[hp gauge の GIF]

## Install        — npx @saber5656/tokenmeter
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
| P0 | Codex `total_token_usage` の意味論（累積か差分か、`reasoning_output_tokens` の重複計上） | Issue #3 で解決。4 component の累積差分を使い、reasoning は output の内数、`total_tokens` は非 authoritative とする（§5.2） |
| P0 | Codex ログからの model 名取得可否 | Issue #3 で解決。直前の `turn_context.payload.model` を使い、取得不能時は推測せず `null` とする |
| P1 | ブロック按分近似の誤差が lens の説得力を損なう | 「実測合計は正確・内訳は近似」を UI に常時明示。ターン合計と実測の突合テスト |
| P1 | 料金表の陳腐化（新モデル追従） | LiteLLM 互換の外部差し替え口 + 単価不明モデルは「未計上」を明示（黙って $0 にしない） |
| P2 | ログ肥大時の scan 性能 | incremental cursor（§5.4）。ベンチは 10 万イベントで計測 |
| P2 | Claude Code / Codex のログ形式変更 | adapter を fixture テストで固定し、形式変更を CI で検知 |

**実ログ確認済み evidence（2026-07-11, aggregate-only）**:

- Claude Code: 複数 file/session の structural audit で、同一 call の identical/progressive usage rows と terminal snapshot を確認した。単純な JSONL 行合算はしない
- Claude Code compact: structural marker は調査 corpus で未観測。未観測を不在と断定せず、controlled `/compact` の human choice が決まるまで検出契約を確定しない
- Codex: 複数 rollout/session の arithmetic audit で component total の累積性、unchanged repeat、counter decrease、cache/reasoning の包含関係を確認した。`total_tokens` には context-window-sized offset anomaly があり authoritative source から除外した
- Codex model: token snapshot と直前の `turn_context.payload.model` の stateful association を確認した。provider metadata は model fallback に使わない
- corpus counts と詳細 evidence は private task record にだけ保存する。repository へ公開する fixture は raw log の masking ではなく allowlist から再構築した synthetic data のみ

---

## 10. v1 Issue 分割案（10 個 / 実 Issue #3–#12）

マイルストーン: **M0 コア（#3–#8）→ M1 meter/hp（#9–#10）→ M2 lens（#11）→ M3 viz（#12）**。§2 の段階リリース方針に対応する。

- **#3 `Spike: confirm usage semantics in Claude Code and Codex session logs`** — ラベル: `spike`, `design`
  実ログ複数本から、Claude Code の usage（差分値・model 名・compact イベントの形）と Codex の `total_token_usage`（累積/差分、reasoning の重複、model 名の所在）を確定し、UsageEvent スキーマを最終化する。
  受け入れ条件: フィールド対応表と差分化ルールを Issue コメントに記録し、fixture 用サンプルログ（マスク済み）を `test/fixtures/` に追加。

- **#4 `Set up CLI scaffold, config loading, and npm packaging`** — ラベル: `infra`
  TypeScript + commander + tsup + vitest の雛形、`~/.tokenmeter/config.json` の読み書き、CI（lint + test）、scoped package identity の metadata 反映（公開・予約は別 gate）。
  受け入れ条件: ローカル pack をインストールした隔離環境で `npx --no-install @saber5656/tokenmeter --help` が動作し、CI が緑、package/bin metadata が承認済み identity と一致する。package は未予約・未公開で、registry 再確認と publish は別の human release gate とする。

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
