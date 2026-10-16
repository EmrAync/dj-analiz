"""ai.py testleri (ağ yok: sahte HTTP yanıtları). python3 -B tests/test_ai.py"""
from __future__ import annotations

import io
import json
import os
import sys
import traceback
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))

from djdoktor import ai  # noqa: E402

SCHEMA = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}
PREFS = {"ai_api_key": "sk-ant-test-1234567890", "ai_model": "", "ai_effort": "medium"}


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def opener_ok(payload, seen):
    def op(req, timeout=None):
        seen["req"] = req
        seen["body"] = json.loads(req.data.decode("utf-8"))
        seen["timeout"] = timeout
        return _Resp(json.dumps(payload).encode("utf-8"))
    return op


def opener_http(code, body=b"{}", headers=None):
    def op(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, code, "x", headers or {}, io.BytesIO(body))
    return op


def test_request_shape_and_parse():
    seen = {}
    payload = {"model": "claude-opus-5-5", "stop_reason": "end_turn",
               "content": [{"type": "thinking", "thinking": ""}, {"type": "text", "text": "{\"ok\": true}"}],
               "usage": {"input_tokens": 10, "output_tokens": 5}}
    out = ai.ask_json("merhaba", SCHEMA, PREFS, system="sistem", opener=opener_ok(payload, seen))
    assert out["ok"] is True and out["_model"] == "claude-opus-5-5"
    b = seen["body"]
    assert b["model"] == "claude-opus-5-5" and b["fallbacks"] == "default"
    assert b["output_config"]["format"]["type"] == "json_schema" and b["output_config"]["effort"] == "medium"
    assert "thinking" not in b and b["system"] == "sistem"
    h = {k.lower(): v for k, v in seen["req"].header_items()}
    assert h["x-api-key"] == PREFS["ai_api_key"] and h["anthropic-version"] == "2023-06-01"
    assert h["anthropic-beta"] == "server-side-fallback-2026-07-01"


def test_errors():
    for code, want in ((401, "ai_auth"), (403, "ai_forbidden"), (429, "ai_busy"), (400, "ai_bad_request"),
                       (500, "ai_server"), (529, "ai_server")):
        try:
            ai.ask_json("x", SCHEMA, PREFS, opener=opener_http(code, b'{"error":{"message":"bad"}}', {"retry-after": "7"}))
            raise AssertionError("hata beklenirdi")
        except ai.AIError as e:
            assert e.code == want, (code, e.code)
            if code == 429:
                assert e.retry_after == 7
    for stop, want in (("refusal", "ai_refusal"), ("max_tokens", "ai_truncated")):
        try:
            ai.ask_json("x", SCHEMA, PREFS, opener=opener_ok({"stop_reason": stop, "content": []}, {}))
            raise AssertionError("hata beklenirdi")
        except ai.AIError as e:
            assert e.code == want
    try:
        ai.ask_json("x", SCHEMA, {"ai_api_key": ""}, opener=opener_ok({}, {}))
        raise AssertionError("anahtarsız istek gitmemeli")
    except ai.AIError as e:
        assert e.code == "ai_no_key"

    def offline(req, timeout=None):
        raise urllib.error.URLError(OSError("Name or service not known"))
    try:
        ai.ask_json("x", SCHEMA, PREFS, opener=offline)
        raise AssertionError("hata beklenirdi")
    except ai.AIError as e:
        assert e.code == "ai_offline"


def test_mask():
    assert ai.mask("sk-ant-abcdefghijklmnop") == "sk-ant-…mnop" and ai.mask("") == ""


if __name__ == "__main__":
    ok = fail = 0
    for k, v in sorted(globals().items()):
        if k.startswith("test_"):
            try:
                v()
                print("OK   ", k)
                ok += 1
            except Exception:
                print("FAIL ", k)
                traceback.print_exc()
                fail += 1
    print("%d geçti, %d başarısız" % (ok, fail))
    sys.exit(1 if fail else 0)
