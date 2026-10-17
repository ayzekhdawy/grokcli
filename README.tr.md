<div align="center">

# GrokCLI

**Grok CLI için hızlı ve kararlı Windows masaüstü uygulaması.**

[Web sitesi](https://grok.noniux.com) · [İndir](https://github.com/ayzekhdawy/grokcli/releases) · [Gizlilik](https://grok.noniux.com/privacy) · [English](README.md)

</div>

![GrokCLI sohbet](docs/screenshots/chat.png)

## GrokCLI nedir?

GrokCLI, bilgisayarındaki `grok` komut satırı ajanını kullanan bir masaüstü uygulamasıdır (Tauri 2 + WebView2). Sohbetlerin, oturumların, onayların ve dosyaların bilgisayarında kalır. Uygulama CLI'ın yerini almaz; ona hızlı ve klavyeyle rahat kullanılan bir arayüz kazandırır.

## Özellikler

- **Sohbet ve oturumlar:** Ajanın yanıtları canlı akar. Sohbetleri sabitleyebilir, oturumlara anında dönebilir ya da aralarında geçiş yapabilirsin.
- **Onaylar:** Araç çağrılarını sohbetin içinde görür, onaylar ya da reddedersin.
- **Yüzen maskot paneli:** Masaüstünde duran maskot bir hızlı erişim paneli açar:
  - prompt kutusu: `Enter` arka planda gönderir, `Ctrl+Enter` gönderip sohbeti açar
  - sesle yazma
  - canlı durumlu oturum geçişi (onay bekliyor, çalışıyor, boşta)
  - ana pencereyi açmadan Onayla, Reddet ve Durdur
  - en fazla 12 kayıtlı prompt
  - genel kısayol `Alt+Win+P`
- **Tam Türkçe arayüz**, İngilizce de var.
- **Kararlılık:** Pencere ve IPC işlemleri arayüzü kilitlemez, bağlantı kilidi takılırsa kendini toparlar ve donmalara karşı koruma testleri vardır.

## Kurulum

1. Grok CLI'ı kur ve giriş yap (`grok` komutu `PATH` içinde olmalı).
2. [Releases](https://github.com/ayzekhdawy/grokcli/releases) sayfasından son `GrokCLI_x.y.z_x64-setup.exe` dosyasını indir.
3. Kurulum dosyasını çalıştır. Dosya henüz imzalı olmadığı için SmartScreen uyarı verebilir. **Ek bilgi → Yine de çalıştır** seçeneğiyle devam et.

**Gereksinimler:** Windows 10/11 x64, WebView2 ve Grok CLI.

## Kaynaktan derleme

Node.js 22, pnpm ve MSVC araç zinciriyle kurulmuş kararlı sürüm Rust gerekir.

```bash
pnpm install
pnpm tauri dev
pnpm tauri build --bundles nsis
```

## Lisans

[MIT](LICENSE).

## Teşekkürler

GrokCLI, [RongleCat/grok-app](https://github.com/RongleCat/grok-app) projesinin (MIT) bir forkudur. Yazarına ve katkıda bulunanlara teşekkürler. Orijinal telif bildirimi [LICENSE](LICENSE) dosyasında korunmaktadır.
