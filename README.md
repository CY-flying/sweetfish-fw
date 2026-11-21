# sweetfish-fw

SweetFish 电子相册的固件更新通道。这个仓库**只放可下载的发布物**，源码在私有仓库里，不在这里。

## 设备侧怎么用

网页端「设置在线更新地址」填这一行，设备就能检查更新：

```
https://cdn.jsdelivr.net/gh/CY-flying/sweetfish-fw@main/manifest.json
```

设备会先拉 `manifest.json` 比对版本，确认有新版才开始下载 `photopainter_album.bin`，边下边算 SHA256，校验不过就丢弃、不切槽。

## 里面有什么

| 文件 | 说明 |
|---|---|
| `manifest.json` | 版本号、固件地址、大小、SHA256、更新说明（最多 6 条），以及 54 项媒体资源的地址 |
| `photopainter_album.bin` | 应用镜像，烧到 `0x20000` |
| `assets/` | 语音包等媒体资源，按设备上的路径镜像排列（`assets/sounds/rikki/boot.wav` → 设备 `/sounds/rikki/boot.wav`） |

## 为什么是公开仓库

设备的下载器不带任何凭据，走 `esp_crt_bundle` 校验证书，地址必须是 https。jsDelivr 只索引公开仓库，私有仓库在它那里永远是 404 —— 所以这个仓库必须是 public。

## 不要手改

`manifest.json` 由 `tools/publish_fw.ps1` 生成（源码仓库里），里面每一条 SHA256 都对应真实文件，手改必然导致设备校验失败。
