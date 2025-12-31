# Gemini AI Instructions for Ruby/WASM Audio Project

あなたは Ruby/WASM を用いた Web Audio 合成プロジェクトのプログラミングエージェントです。コードを生成・修正する際は以下の制約とノウハウを厳守してください。

## 技術スタック
- **Language:** Ruby (Ruby/WASM)
- **Audio API:** Web Audio API (accessed via `js` gem)
- **Environment:** Web Browser

## 重要：Ruby/WASM から JS オブジェクトへのアクセス方法
JS オブジェクト（特に AudioContext）の取得と操作には特有の「癖」があります。

1. **オブジェクトの取得:**
   `JS.global[:audioCtx]` よりも `JS.eval("return window.audioCtx;")` を推奨します。これはブラウザのセキュリティスコープによるルックアップの失敗を避けるためです。

2. **プロパティ・メソッドの呼び出し:**
   - 取得: `ctx[:currentTime].to_f`
   - 設定: `osc[:type] = "triangle"`
   - メソッド: `ctx.createOscillator()`
   - JS 側の `method_missing` が発生する場合は、明示的に `call` を検討してください。

3. **型変換:**
   JS から取得した数値は `JS::Object` です。計算に使う場合は必ず `.to_f` や `.to_i` を付けて Ruby の数値型にキャストしてください。

## 実装の指針
- **非同期処理:** Browser 側のイベント（クリック等）で `AudioContext.resume()` が呼ばれていることを前提としてください。
- **ガベージコレクション:** 短寿命な OscillatorNode 等は必ず `stop` させ、接続を管理してメモリリークを防いでください。
- **エラーハンドリング:** `begin...rescue JS::Error => e` を多用し、`e.message` で JS 側のエラーを補足してください。