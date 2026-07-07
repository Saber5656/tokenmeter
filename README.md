# tokenmeter

Local-first token & context observability for AI agents.

全エージェント・全プロバイダ横断で、トークン使用量・コスト・context window の状態をローカルで観測する CLI。計測コアの上に、コストメーター、残量 HP ゲージ、消費内訳の分析、context の中身のリアルタイム可視化を統合する。

## Features (planned)

| Subcommand | 内容 | 由来 |
|---|---|---|
| `meter` | 全エージェント・全プロバイダ横断のローカルコストメーター。予算アラート付き | 本 repo の元スコープ |
| `hp` | トークン予算残量を HP ゲージ風に可視化。消費でダメージ演出、残量僅少で警告 | [tokenhp](https://github.com/Saber5656/tokenhp) を統合 |
| `lens` | 実測データに基づくトークン消費内訳の可視化と削減案の提示 | [tokenlens](https://github.com/Saber5656/tokenlens) を統合 |
| `viz` | LLM の context window の中身と押し出し（eviction）をリアルタイム可視化 | [memviz](https://github.com/Saber5656/memviz) を統合 |

## Status

設計フェーズ。v1 は計測コア → `meter` / `hp` → `lens` → `viz` の順で段階的に実装する。
