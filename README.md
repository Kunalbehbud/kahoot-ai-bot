# 🤖 Kahoot AI Bot — Azərbaycan Tarixi Edition

Kahoot oyununa bağlanıp soruları AI ile otomatik cevaplayan bot.

## Özellikler

- ✅ Otomatik soru algılama ve cevaplama
- ✅ Çoktan seçmeli, doğru/yanlış, yazılı cevap, sıralama desteği
- ✅ Vision modu (soru ekranda gösterilmiyorsa screenshot ile çözer)
- ✅ Gemini + OpenAI desteği (istediğini seç)
- ✅ Azerice tarih odaklı optimize promptlar

## Kurulum

### 1. Node.js gerekli
[Node.js](https://nodejs.org/) kurulu olduğundan emin ol (v18+).

### 2. Bağımlılıkları kur
```bash
cd Kahoot
npm install
```

### 3. API Key ayarla
`.env.example` dosyasını `.env` olarak kopyala ve API key'ini ekle:
```bash
copy .env.example .env
```

**Gemini API Key (ücretsiz):**
1. https://aistudio.google.com/apikey adresine git
2. "Create API Key" tıkla
3. Key'i `.env` dosyasındaki `GEMINI_API_KEY` alanına yapıştır

### 4. Botu çalıştır
```bash
npm start
```

## Kullanım

1. `npm start` ile botu başlat
2. Kahoot game PIN'ini gir
3. Bot ismini gir (veya Enter'a bas, default isim kullanılır)
4. Bot otomatik olarak oyuna katılır ve soruları cevaplar

## Konfigürasyon (.env)

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `LLM_PROVIDER` | `gemini` veya `openai` | `gemini` |
| `GEMINI_API_KEY` | Google AI Studio API key | - |
| `GEMINI_MODEL` | Gemini model adı | `gemini-2.0-flash` |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `OPENAI_MODEL` | OpenAI model adı | `gpt-4o` |
| `BOT_NAME` | Varsayılan bot ismi | `Player` |

## Notlar

⚠️ **Host Ayarı**: Host "Show questions & answers on participants' devices" açmışsa bot tam otomatik çalışır. Açmamışsa otomatik olarak Vision moduna geçer (ekran görüntüsü alıp AI'a gönderir).
