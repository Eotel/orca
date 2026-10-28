# fork 版の作り直し（上流の更新を取り込むとき）

fork の修正は、次の 2 本の branch で持つ。

- `eotel/main` に入れる修正の branch（例: `Eotel/orca-fork-fixes`）
- 動かす版の branch。上流の配布タグに同じ commit を載せる（例: `Eotel/fork-1.4.243-fixes`）

上流の新しい版を取り込むときは、新しいタグから動かす版を作り直す。

## 手順

1. 上流のタグを取り、別の worktree で動かす版の branch を作る。

   ```sh
   git fetch origin tag vX.Y.Z --no-tags
   git worktree add -b Eotel/fork-X.Y.Z-fixes <作業場> vX.Y.Z
   ```

2. fork の修正を cherry-pick する。fork だけの commit は `git log --oneline origin/main..fork/eotel/main` で出る。このうち、上流にまだ入っていないもので、動かす版に入れるものを選ぶ。
3. 依存を入れる。モバイル版 Web の部品を作るため、`mobile/` の依存も要る。

   ```sh
   pnpm install --frozen-lockfile
   pnpm --dir mobile install --frozen-lockfile
   ```

4. 修正したテストを流す（`pnpm test <file>`）。
5. 部品を作る。`pnpm build:mac` は最後に x64 も作ろうとして止まるので、その手前までを流す。

   ```sh
   pnpm run build:desktop && pnpm run build:computer-macos \
     && pnpm run build:keyboard-layout-macos && pnpm run build:process-footprint-macos \
     && pnpm run build:notification-status-macos && pnpm run ensure:electron-runtime
   ```

6. arm64 の .app だけを作る。版は `X.Y.Z-local.<時刻>.<commit>` になる。

   ```sh
   C=$(git rev-parse --short=12 HEAD)
   V=$(node -e "import('./config/scripts/build-mac-local.mjs').then(m=>console.log(m.createLocalBuildVersion('X.Y.Z',Date.now(),'$C')))")
   ORCA_BUILD_COMMIT=$C ORCA_LOCAL_BUILD_VERSION=$V \
     pnpm exec electron-builder --config config/electron-builder.config.cjs --mac dir --arm64
   ```

7. 確かめる。
   - `codesign --verify --deep --strict dist/mac-arm64/Orca.app` が通る。
   - `Info.plist` の `CFBundleShortVersionString` が新しい版になっている。
   - 直した処理が、`Contents/Resources/app.asar.unpacked/out/renderer/assets/` などの出力に入っている。

## 注意

- 署名は、手元にある Apple Development の証明書が自動で選ばれる。配布版とは署名が変わるため、初回の起動で鍵束の「Orca Safe Storage」の許可を求められる。
- 手元のビルドには `app-update.yml` が入らない。更新の取得先を持たないので、上流の版で上書きされない。上流の更新は、この手順で作り直して取り込む。
- `out/orcad-template` は、他の OS 向けの部品を CI で作る前提のため、手元では作れない。Mac で app として動く `orca serve` は常に Electron を使う（`src/cli/runtime/launch.ts` の `usesMacUpdateHandoff`）ので、無くても修正したコードが動く。SSH の接続先などへ orcad を配る機能が要るときは、同じ版の配布版の `Contents/Resources/orcad-template` を `out/orcad-template` に写してから手順 6 を流す。
