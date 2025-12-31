# Ruby/WASM Audio Development HOWTO

## プロジェクトのセットアップ
1. `index.html` で `ruby-wasm-wasi` を読み込む。
2. JavaScript 側で `window.audioCtx` をユーザーアクション（クリック）時に初期化する。
3. Ruby スクリプトを `vm.eval` で実行する。

## Gemini CLI への指示の出し方
新しい音色やシーケンスを追加する際は、以下の情報を与えると精度が上がります。

- **音色の特徴:** 「三角波ベース」「アタック長め」「デチューンあり」など。
- **シーケンスのリズム:** 「8分音符」「BPM120」など。
- **MIDI 連携の有無:** 「MIDI ノート番号を引数に取る」など。

## トラブルシューティング
- **音が鳴らない場合:** - コンソールの `Status: suspended` を確認。`ctx.resume()` を実行しているかチェック。
- **`JS::Error` が発生する場合:** - プロパティアクセスが `reflect-get` で落ちていないか確認。`JS.eval` 経由の取得に切り替える。
- **音が割れる場合:**
  - 複数の Oscillator を鳴らす際は Master Gain を `1.0 / 音数` に設定する。

## 開発フロー
1. `Synthesizer` クラスで波形の生成を行う。
2. `Sequencer` クラスで時間の管理（`currentTime` ベースのスケジュール）を行う。
3. `JS.eval` をブリッジとして使い、MIDI や UI のイベントを Ruby に流し込む。
