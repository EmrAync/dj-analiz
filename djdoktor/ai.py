"""Yapay zekâ (Claude) ile liste önerisi — İSTEĞE BAĞLI.

Kullanıcı Ayarlar'a kendi Anthropic API anahtarını girerse, Mix Asistanı bir isteği ("Kına gecesi, 90 dk, sakin
başla, coşkulu bitir") kütüphaneden önceden seçilmiş KISA bir aday listesiyle birlikte Claude'a gönderir ve sıralı
bir liste geri alır. Anahtar yoksa ya da internet yoksa program çevrimdışı set kurucusunu kullanır.

Neden SDK değil de düz HTTP? Programın kuralı: mutagen dışında bağımlılık yok ve Python 3.8+ (macOS'un kendi
Python'u 3.9). Resmî `anthropic` SDK 1.x Python 3.10+ ister ve kurulum gerektirir; bu yüzden aynı Messages API'si
urllib ile çağrılır (POST https://api.anthropic.com/v1/messages).

Gizlilik: yalnızca şarkı bilgileri (ad, sanatçı, tür, BPM, ton, enerji, süre) gönderilir; ses dosyası, dosya yolu
ya da kişisel bilgi gönderilmez. API anahtarı yalnızca bu bilgisayardaki ayarlarda durur ve günlüğe yazılmaz.
"""
from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request

API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = "claude-opus-5-5"
API_VERSION = "2023-06-01"
FALLBACK_BETA = "server-side-fallback-2026-07-01"   # reddedilen istek sunucuda uygun modelle yeniden çalışır
TIMEOUT = 240


class AIError(Exception):
    """Kullanıcıya gösterilecek kısa Türkçe hata. code: arayüzün davranışı için."""

    def __init__(self, msg, code="ai_error", retry_after=None):
        super().__init__(msg)
        self.code = code
        self.retry_after = retry_after


def settings_of(prefs):
    """(api_key, model, effort) — anahtar ayarlarda yoksa ortam değişkeni ANTHROPIC_API_KEY."""
    import os
    key = (prefs.get("ai_api_key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()
    model = (prefs.get("ai_model") or DEFAULT_MODEL).strip() or DEFAULT_MODEL
    effort = prefs.get("ai_effort") or "medium"
    if effort not in ("low", "medium", "high", "xhigh", "max"):
        effort = "medium"
    return key, model, effort


def mask(key):
    key = key or ""
    return (key[:7] + "…" + key[-4:]) if len(key) > 14 else ("…" if key else "")


def _post(body, key, timeout=TIMEOUT, opener=None):
    """Messages API'ye tek istek. opener testlerde sahte yanıt vermek için değiştirilir."""
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API_URL, data=data, method="POST", headers={
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
        "anthropic-beta": FALLBACK_BETA,
    })
    op = opener or urllib.request.urlopen
    try:
        with op(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            info = json.loads(e.read().decode("utf-8"))
            detail = ((info or {}).get("error") or {}).get("message") or ""
        except Exception:
            detail = ""
        if e.code in (401,):
            raise AIError("API anahtarı geçersiz. Ayarlar'dan anahtarı kontrol et.", "ai_auth")
        if e.code == 403:
            raise AIError("Bu API anahtarının bu modele erişimi yok.", "ai_forbidden")
        if e.code == 429:
            ra = e.headers.get("retry-after") if e.headers else None
            raise AIError("Yapay zekâ şu an çok yoğun; biraz sonra tekrar dene.", "ai_busy",
                          retry_after=int(ra) if ra and str(ra).isdigit() else None)
        if e.code == 400:
            raise AIError("İstek kabul edilmedi: %s" % (detail[:200] or "geçersiz istek"), "ai_bad_request")
        if e.code >= 500 or e.code == 529:
            raise AIError("Yapay zekâ hizmetinde geçici bir sorun var; biraz sonra tekrar dene.", "ai_server")
        raise AIError("Yapay zekâ isteği başarısız (%d)." % e.code, "ai_error")
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as e:
        reason = getattr(e, "reason", e)
        if isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason):
            raise AIError("Yapay zekâ zamanında yanıt vermedi; tekrar dene ya da isteği kısalt.", "ai_timeout")
        raise AIError("İnternete bağlanılamadı. Yapay zekâ olmadan çevrimdışı öneriler kullanılabilir.", "ai_offline")


def ask_json(prompt, schema, prefs, system=None, max_tokens=16000, opener=None):
    """Claude'a sorar, yanıtı verilen JSON şemasına uygun nesne olarak döndürür."""
    key, model, effort = settings_of(prefs)
    if not key:
        raise AIError("Yapay zekâ için Ayarlar'a bir Anthropic API anahtarı gir.", "ai_no_key")
    body = {
        "model": model,
        "max_tokens": max_tokens,
        "fallbacks": "default",
        "output_config": {"effort": effort, "format": {"type": "json_schema", "schema": schema}},
        "messages": [{"role": "user", "content": prompt}],
    }
    if system:
        body["system"] = system
    res = _post(body, key, opener=opener)
    stop = res.get("stop_reason")
    if stop == "refusal":
        raise AIError("Yapay zekâ bu isteği yanıtlamadı. İsteği farklı sözcüklerle yeniden yaz.", "ai_refusal")
    if stop == "max_tokens":
        raise AIError("Yanıt yarım kaldı (çok uzun). Daha kısa bir liste iste.", "ai_truncated")
    text = "".join(b.get("text") or "" for b in (res.get("content") or []) if b.get("type") == "text")
    if not text.strip():
        raise AIError("Yapay zekâdan boş yanıt geldi.", "ai_empty")
    try:
        out = json.loads(text)
    except ValueError:
        raise AIError("Yapay zekânın yanıtı okunamadı.", "ai_parse")
    out["_model"] = res.get("model") or model
    out["_usage"] = {k: v for k, v in (res.get("usage") or {}).items() if isinstance(v, (int, float))}
    return out


def test_key(prefs, opener=None):
    """Anahtarı kısa bir istekle dener (Ayarlar > 'Dene')."""
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"],
              "additionalProperties": False}
    out = ask_json("Yanıt olarak yalnızca {\"ok\": true} döndür.", schema, dict(prefs, ai_effort="low"),
                   max_tokens=2000, opener=opener)
    return {"ok": bool(out.get("ok")), "model": out.get("_model")}
