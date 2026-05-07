# SRT Generator Prototype

動画をアップロードすると、**Macの中だけで文字起こし**して、SRT字幕ファイルと字幕付き動画を作れる試作アプリです。  
**OpenAI APIキーは不要**で、**ローカル処理**で動き、**無料で試せる**構成です。

## 主なポイント

- APIキー不要
- ローカル処理
- 無料で試せる
- SRTダウンロード対応
- 字幕編集対応
- 字幕付き動画の書き出し対応

## このアプリでできること

- mp4 / mov / webm の動画をアップロード
- ローカルWhisperモデルで日本語文字起こし
- 方言ヒント、地名、人名の入力
- SRT字幕の生成
- 字幕本文の編集
- 動画プレビューを見ながら字幕デザイン調整
- 字幕付き mp4 の再生成

## このアプリの特徴

- **APIキー不要**
  OpenAI API は使いません。
- **ローカル処理**
  文字起こしはあなたのMac上で実行します。
- **無料で使える**
  API課金なしで試せます。
- **初心者でも触りやすいUI**
  動画を選んで、字幕を作って、必要なら編集してダウンロードできます。

## 技術スタック

- Next.js
- TypeScript
- Tailwind CSS
- Node.js
- `@huggingface/transformers`
- `ffmpeg-static`

## 動作イメージ

1. 動画を選ぶ
2. 必要なら方言ヒントを入れる
3. `字幕を生成する` を押す
4. 字幕を編集する
5. `編集後SRTをダウンロード` または `字幕付き動画をダウンロード` を押す

## 必要なもの

- macOS
- Node.js 20 以上
- インターネット接続

補足:
- APIキーは不要です
- 最初の1回だけ、ローカル文字起こしモデルのダウンロードに時間がかかります

## セットアップ方法

### 1. このプロジェクトを開く

ターミナルでこのフォルダに移動します。

```bash
cd /Users/tanakatakako/Documents/Codex/2026-05-07-srt-web-srt-ok-next-js
```

### 2. 必要な部品を入れる

```bash
npm install
```

### 3. 開発サーバーを起動する

```bash
npm run dev
```

### 4. ブラウザで開く

[http://localhost:3000](http://localhost:3000)

## 使い方

### 字幕を作る

1. `動画ファイルを選択` を押す
2. 必要なら `方言ヒント・地名・人名` を入れる
3. `字幕を生成する` を押す
4. 生成完了後、`VIDEO PREVIEW` と `Subtitle Editor` で確認する

### 字幕を編集する

- `ブロック編集`
  会話形式の動画向けです
- `全文編集`
  一人語りや長めの文章向けです

### ダウンロードする

- `編集後SRTをダウンロード`
- `字幕付き動画をダウンロード`
- `文字起こし直後のSRTをダウンロード`

## GitHubに公開するときの注意

このプロジェクトでは、次のようなファイルはGitHubに上げないでください。

- `.env.local`
- `node_modules`
- `.next`
- 生成された `.srt`
- アップロードした動画ファイル
- 一時音声ファイル
- `.ass` などの字幕中間ファイル
- ログファイル
- モデルキャッシュや大容量ファイル

このリポジトリでは `.gitignore` で除外する前提です。

## よくある質問

### Q. OpenAI APIキーは必要ですか？

不要です。  
このアプリはローカル文字起こしで動きます。

### Q. 完全に無料ですか？

はい、OpenAI API の課金は発生しません。  
ただし、Mac上で処理するため、PCの性能や空き容量は必要です。

### Q. 最初だけ時間がかかるのはなぜ？

最初の1回は、ローカル文字起こしモデルをダウンロードするためです。

## ライセンス

このリポジトリは **MIT License** です。  
商用利用、改変、再配布がしやすく、公開リポジトリとの相性がよいライセンスです。

## GitHub公開手順

ここでは、**GitHubにまだ慣れていない人向け**に、1つずつ書きます。

### 1. GitHubで新しいリポジトリを作る

1. GitHubにログインする
2. `New repository` を押す
3. リポジトリ名を入れる  
   例: `srt-generator-prototype`
4. `Public` を選ぶ
5. `Create repository` を押す

### 2. このフォルダでGitを初期化する

ターミナルでこのプロジェクトフォルダを開いた状態で、次を順番に実行します。

```bash
git init
```

### 3. GitHubに上げてはいけないものを確認する

まず、`.gitignore` がある状態で次を実行します。

```bash
git status
```

見るポイント:
- `.env.local` が出てこない
- `node_modules` が出てこない
- 動画ファイルが出てこない
- `.srt` が出てこない

### 4. 最初の保存をする

```bash
git add .
git commit -m "Initial commit"
```

### 5. GitHubのリポジトリとつなぐ

GitHubで新規リポジトリを作ると、最後にURLが出ます。  
そのURLを使って、次のように実行します。

```bash
git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
```

例:

```bash
git remote add origin https://github.com/example-user/srt-generator-prototype.git
```

### 6. GitHubへ公開する

```bash
git branch -M main
git push -u origin main
```

これで公開できます。

## 公開後に修正を反映する方法

ファイルを直したあと、次の3つを順番に実行します。

```bash
git add .
git commit -m "Update UI"
git push
```

意味:

- `git add .`
  変更したファイルをまとめる
- `git commit -m "..."`  
  何を変えたか名前をつけて保存する
- `git push`
  GitHubに反映する

## 公開前の最終確認

GitHubに上げる前に、これだけ確認してください。

```bash
git status
```

そして、次のものが一覧に出ていないことを確認します。

- `.env.local`
- `node_modules`
- 動画ファイル
- `.srt`
- `.wav`
- `.mp3`
- `.ass`
- ログファイル

## 開発用コマンド

```bash
npm run dev
npm run build
npm run start
```

## 補足

このアプリは試作版です。  
今後、翻訳機能や字幕編集機能をさらに拡張しやすい構成を意識しています。
