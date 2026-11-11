# Lap Logger

スマホのブラウザで動く、サーキット向けのGPSラップタイマーです。バイクにも車にも使えます。
A GPS lap timer for track days that runs in your phone's browser. Works for motorcycles and cars.

**▶ https://kiha81-png.github.io/lap-logger/**

---

## 日本語

### できること
- **計測モード**：サーキット（周回）、ドラッグ（停止からの加速。距離と速度のタイム）、セグメント（A地点からB地点）
- **コース**：「記録だけ」で数周走り、その軌跡をタップしてラインを置けます（スタート/ゴールの自動配置も可）。Googleマップの座標を貼り付けても登録でき、向きは走った記録から自動で決めます。前後・左右・回転・幅の微調整ができます。QRコード・リンク・ファイルで仲間と共有できます。
- **Gメーター**：バイクはGPSから計算、車はスマホの加速度センサーで測ります。
- **解析**：ラップの統計（速度、ブレーキと惰性の時間）、再生スライダー、地図への速度とGの表示、2ラップの比較（タイム差）、G-G図
- **その他**：日本語／English、km/h／mph、横画面、屋外向けの高コントラスト表示、色覚に配慮した配色、オフラインでの起動

### 使い方
1. 上のURLをスマホで開き、位置情報を許可します。「ホーム画面に追加」すると、アプリのように使えて、データも消えにくくなります。
2. 「コース」タブで「新規」を押し、そのまま計測を始めて数周走ります（コースが未完成のあいだは記録だけになります）。
3. 「コース」タブの「走った記録から作る」で、その記録を選びます。「自動で作る」でスタート/ゴールが置かれます。セクターは図の走行ラインをタップして置きます。Googleマップの座標を貼り付けても作れます。
4. 大事な記録は、「設定 → 全データをバックアップ」で保存しておいてください。
5. 走行ごとに自分の Google スプレッドシート・ドライブへ自動で送ることもできます（任意）。準備は [docs/GOOGLE_SYNC.md](docs/GOOGLE_SYNC.md) を見てください。

### 安全について
- **走行中は、スマホを見たり操作したりしないでください。**
- スマホは、しっかり固定してください（自己責任）。車載や計測が認められているかは、走行会やサーキットの規則で確認してください。
- タイム・速度・Gは、スマホのGPS（ふつうは1秒に1回の更新）とセンサーから求めた**目安**です。公式の計時の代わりにはなりません。

### プライバシー
- **データはすべて、あなたの端末のブラウザの中だけに保存されます。** 走行データ・位置・設定を、作者を含む外部に送ることはありません。
- 例外は、設定の「Googleに保存」を自分でオンにした場合だけです。そのときは、自分で用意した Google Apps Script（自分のスプレッドシート・ドライブ）にだけ送ります。
- アプリは、ブラウザの機能（Content-Security-Policy）で、Google Apps Script（script.google.com）以外との通信をできないようにしています。
- 解析ツール、広告、クッキーによる追跡は使っていません。
- このページは GitHub Pages で公開しています。ページを開いたときのアクセス記録（IPアドレスなど）は、GitHub の方針に従って GitHub 側に残ります。
- 書き出したファイル（JSON・CSV）には、走った場所と時刻が入っています。人に渡すときは注意してください。

### 制限
- 画面を消したり、他のアプリに切り替えたりすると、記録が止まります（Webアプリの制約）。
- 外付けのGPSや、車両のECUのデータには対応していません。
- iPhoneのブラウザは、しばらく開かないサイトのデータを消すことがあります。ホーム画面に追加し、定期的にバックアップしてください。
- 動作の目安：iOS 16.4 以降の Safari、最近の Android の Chrome。

### 不具合の報告
[Issues](https://github.com/kiha81-png/lap-logger/issues) から報告してください。「設定 → 端末情報をコピー」の内容を貼ってもらえると助かります。
**走行データ（JSON・CSV）や、位置がわかる情報は貼らないでください。** Issues は公開されます。

---

## English

### Features
- **Modes**: Circuit (laps), Drag (standing start; distance and speed times), Segment (point A to point B)
- **Tracks**: drive a few laps in recording-only mode, then tap the driven path to place lines (or place the start/finish automatically). You can also paste coordinates from Google Maps; directions are set automatically from a recording. Fine-tune position, rotation and width. Share tracks by QR code, link or file.
- **G meter**: calculated from GPS for motorcycles, measured with the phone motion sensor for cars.
- **Analysis**: lap stats (speed, brake and coast time), playback slider, speed/G on the map, two-lap comparison (time delta), G-G diagram
- **Other**: Japanese/English, km/h/mph, landscape, high-contrast outdoor display, color-vision friendly colors, works offline

### Safety
- **Do not look at or touch the phone while riding or driving.**
- Mount the phone securely at your own responsibility, and check the event or track rules.
- Times, speeds and G are **estimates** from the phone GPS (usually 1 update per second) and sensors. They are not official timing.

### Privacy
- **All data stays in your browser on your device.** Nothing — driving data, location or settings — is sent anywhere, including to the author.
- The only exception is the optional "Save to Google" setting, which sends recordings to a Google Apps Script you set up yourself (your own Sheet and Drive). See [docs/GOOGLE_SYNC.md](docs/GOOGLE_SYNC.md) (Japanese).
- A Content-Security-Policy blocks all outbound connections from the app except Google Apps Script (script.google.com).
- No analytics, ads or tracking cookies.
- The page is hosted on GitHub Pages; GitHub keeps access logs (such as IP addresses) under its own policies.
- Exported files (JSON/CSV) contain where and when you drove. Be careful when sharing them.

### Limitations
- Recording stops if the screen turns off or you switch apps (a web app limitation).
- External GPS receivers and vehicle ECU data are not supported.
- iPhone browsers may delete data of sites not opened for a while. Add the app to your home screen and back up regularly.
- Target platforms: Safari on iOS 16.4+, recent Chrome on Android.

### Reporting bugs
Use [Issues](https://github.com/kiha81-png/lap-logger/issues) and paste "Settings → Copy device info". **Do not paste driving data or anything that reveals locations.** Issues are public.

---

## 開発メモ / Development

- `index.html` がアプリ本体、`sw.js` がオフライン対応、`manifest.webmanifest` がホーム画面用の設定です。
- **更新するときは、`index.html` の `APP_VERSION` と `sw.js` の `VERSION` を同じ値に上げてください。**
- 保存データの形を変えるときは、`SCHEMA` を上げ、`DB.open()` の `onupgradeneeded` に移行処理を書きます（移行前に `backups` へ控えを取ります）。
- テスト：`python tests/run_tests.py`（Python、`pip install playwright zxing-cpp pillow`、Microsoft Edge。Edge が無ければ Playwright の Chromium を使います。`BROWSER_PATH` でブラウザを指定することもできます）
- 公開前の実機確認：[`docs/DEVICE_TEST.md`](docs/DEVICE_TEST.md)

## License

[MIT](LICENSE)
