# Ruby/WASM Web Synth

Ruby/WASM を用いてブラウザ上で動作するシンセサイザー＆シーケンサープロジェクトです。

## プロジェクト構成

- `index.html`: エントリーポイント。Import Map による依存関係の解決と UI。
- `main.js`: Ruby VM の初期化、Ruby スクリプトのフェッチ、JS/Ruby のブリッジ処理。
- `src/`: Ruby ソースコードを配置。
  - `synthesizer.rb`: シンセサイザーのロジック（音色生成、ボイス管理）。
- `Rakefile`: 開発用タスク（サーバー起動など）。
- `Gemfile`: 開発環境の依存関係（webrick, rake）。

## 開発環境の準備

Ruby がインストールされている環境で、以下のコマンドを実行して依存関係をセットアップします。

```bash
bundle install
```

## 実行方法

1. 以下のコマンドで開発用サーバーを起動します。
   ```bash
   rake server
   ```
2. ブラウザで `http://localhost:8000` にアクセスします。
3. 「Initialize & Play」ボタンを押すと、Ruby VM がロードされ、`src/synthesizer.rb` の demo 関数が実行されて音が鳴ります。

## 開発のポイント

- **Ruby 側の修正:** `src/*.rb` を編集後、ブラウザをリロードするだけで変更が反映されます（開発時は JS が毎回ファイルを fetch するため）。
- **JS 連携:**
  - Ruby 側で `require "js"` することで、`JS.eval` や `JS.global` を通じて Web Audio API にアクセスしています。
  - JS 側から Ruby のメソッドを呼ぶには `vm.eval("method_name")` を使用します。
- **音色の変更:** `src/synthesizer.rb` 内の `Synthesizer` クラスの `@osc[:type]` を `"sine"`, `"square"`, `"sawtooth"`, `"triangle"` に書き換えることで音色が変わります。

## 注意事項

ブラウザのセキュリティ制限により、AudioContext はボタンクリックなどのユーザーアクション内で `resume()` または生成する必要があります。本プロジェクトでは `main.js` の `onclick` ハンドラ内でこれを処理しています。
