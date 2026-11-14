# 履歴電卓 v2（iPhone向け）

## GitHub Pagesへの配置
このフォルダ内のファイルをすべてリポジトリ直下へアップロードし、Settings → Pages → Deploy from a branch → `main` / `/(root)` を選択します。

## iPhoneでの利用
Safariで公開URLを開き、共有 → ホーム画面に追加。
数字・演算子は画面内のテンキーで入力します。式表示欄は読み取り専用で、iOS標準キーボードは表示されません。

## 機能
- 四則演算、括弧、少数、負数
- BigIntベースの10進計算（除算は小数点以下15桁で四捨五入）
- 計算履歴の再利用、式コピー、結果の再利用、個別削除・全削除
- JSONバックアップ書き出し
- localStorage保存、Service Workerによるオフラインキャッシュ

履歴式の一部分はiOSのテキスト選択で選択できます。履歴は端末内保存で、端末データ削除時には失われる可能性があります。バックアップを定期的に保存してください。


## Version 1.1.0
- iPhone calculator-style keypad: number keys are grouped on the left and operators are in the right column.
- Equals button spans the bottom row.


## Version 1.2.0
- Added a history action to copy the calculation result.
- Added an undo button to revert the latest expression edit (up to 100 steps).

## Version 1.3.0

- iPhone SE向けに画面レイアウトを簡素化し、不要な表示や余白を削減。
- アプリ名や説明文を削除し、バージョン番号のみ表示。
- 「元に戻す」と「バックアップ」を横並びに配置。
- 履歴の「結果を使う」機能を削除。
- 履歴から復元した式を、iOS標準キーボードを表示せず、アプリ内テンキーで編集できるように修正。
- 式表示欄を操作した際に表示される不要な警告メッセージを解消。
- 式のコピー、計算結果のコピー、バックアップ機能を改善。

## Version 1.4.0

- iPhone向けに画面上部の余白とボタン配置を調整し、操作しやすさを改善。
- 計算式の表示・編集エリアを拡大。
- iOS標準キーボードを表示せずに、計算式欄でカーソルを表示・移動できるように変更。
- 計算式欄をタップすると、その位置にカーソルを移動できるように変更。
- ダブルタップで、その位置の数字を選択できるように変更。
- 計算式欄の直下にカーソル左右移動ボタンと数字選択ボタンを追加。
- バックアップボタンの名称を「履歴を書き出す」に変更し、履歴エリアに移動。