#!/bin/bash
# DJ Doktor 2 — Mac başlatıcı. Çift tıklayın; program kendi penceresinde açılır ve bu Terminal penceresi
# kapatılabilir. Program penceresi kapanınca program da kapanır.
# İlk açılışta program "Masaüstüne kısayol" önerir: sonra masaüstündeki "DJ Doktor" simgesiyle açılır.
# Terminal'de çalıştırmak için:  ./Baslat_Mac.command konsol
cd "$(dirname "$0")" || exit 1
export PYTHONUTF8=1
PY=""
for c in python3 /opt/homebrew/bin/python3 /usr/local/bin/python3 /Library/Frameworks/Python.framework/Versions/Current/bin/python3; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)' >/dev/null 2>&1; then
    PY="$c"
    break
  fi
done
if [ -z "$PY" ]; then
  echo
  echo "Python 3 bulunamadı. Bu program Python 3.8 veya üstü ile çalışır."
  echo
  echo " • macOS 'komut satırı geliştirici araçlarını yükle' penceresi açtıysa 'Yükle'ye basın;"
  echo "   bitince bu dosyayı tekrar açın."
  echo " • Ya da açılan sayfadan Python 3'ü indirip kurun, sonra bu dosyayı tekrar açın."
  open "https://www.python.org/downloads/macos/"
  read -r -p "Kapatmak için Enter'a basın… " _
  exit 1
fi
echo "Python: $PY"
# --detach: program Terminal'den bağımsız (arka planda) yeniden başlar; bu pencere hemen kapanabilir
"$PY" baslat.py --detach "$@"
status=$?
# 1 = Python hatası (ekranda kalsın); 2 = hata zaten gösterildi
if [ $status -eq 1 ]; then
  read -r -p "Kapatmak için Enter'a basın… " _
fi
exit $status
