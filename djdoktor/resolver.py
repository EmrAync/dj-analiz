"""Serato/Engine'deki yolları diskteki gerçek dosyalarla eşleştirir.

Eşleşme sınıfları:
  exact   : bayt bayt aynı -> Mac, Windows ve Prime 4'te çalışır
  unicode : sadece Türkçe harf biçimi (NFC/NFD) farklı -> yalnızca Mac'te çalışır
  sfm     : Mac'e özel karakter farkı (':' '?' sondaki nokta...) -> yalnızca Mac'te çalışır
  case    : sadece büyük/küçük harf farkı -> exFAT'ta çalışır ama kırılgan
  missing : dosya yok (taşınmış / silinmiş / başka diskte)
  nodir   : yolun ait olduğu üst klasör bu kökte hiç yok (kopyada olmayan klasör)
"""
from __future__ import annotations

import os
from collections import defaultdict

from . import names

WORKS_ON = {
    "exact": "Her yerde",
    "case": "Her yerde (exFAT)",
    "unicode": "Sadece Mac",
    "sfm": "Sadece Mac",
    "missing": "Hiçbir yerde",
    "nodir": "Bu diskte değil",
    "outside": "Kök dışında",
}


class Resolver:
    def __init__(self, catalog, root: str):
        self.root = root
        rows = catalog.q("SELECT id, rel, mkey, lkey, present FROM files WHERE kind='audio'")
        self.by_rel = {}
        self.by_mkey = defaultdict(list)
        self.by_lkey = defaultdict(list)
        for r in rows:
            self.by_rel[r["rel"]] = r
            self.by_mkey[r["mkey"]].append(r)
            self.by_lkey[r["lkey"]].append(r)
        try:
            tops = os.listdir(root)
        except OSError:
            tops = []
        self.top_keys = {names.match_key(t).casefold() for t in tops}

    def _pick(self, cands):
        pres = [c for c in cands if c["present"]]
        return (pres or cands)[0] if cands else None

    def resolve(self, rel: str):
        """(file_row | None, sınıf)"""
        if not rel:
            return None, "missing"
        rel = "/".join(names.split_rel(rel))
        r = self.by_rel.get(rel)
        if r and r["present"]:
            return r, "exact"
        mk = names.match_key(rel)
        c = self._pick(self.by_mkey.get(mk, []))
        if c and c["present"]:
            if names.has_sfm(c["rel"]) != names.has_sfm(rel):
                return c, "sfm"
            return c, "unicode"
        c = self._pick(self.by_lkey.get(names.loose_key(rel), []))
        if c and c["present"]:
            return c, "case"
        if r:  # katalogda var ama artık yok
            return r, "missing"
        top = names.split_rel(rel)[0] if names.split_rel(rel) else ""
        if top and names.match_key(top).casefold() not in self.top_keys:
            return None, "nodir"
        return None, "missing"
