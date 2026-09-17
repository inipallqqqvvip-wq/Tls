cat > hunter.py <<'PY'
import re
import sys
import time
from urllib.request import Request, urlopen

OUTPUT = "tokens_hunter.txt"

def fetch_raw(url):
    req = Request(url, headers={"User-Agent": "TokenHunter/1.0"})
    with urlopen(req, timeout=15) as r:
        return r.read().decode("utf-8", errors="ignore")

def extract_tokens(text):
    # Format umum token bot Telegram:
    # angka + ":" + karakter token
    pattern = r'\b\d{6,12}:[A-Za-z0-9_-]{20,}\b'
    return re.findall(pattern, text)

def main():
    url = input("Masukkan Raw GitHub URL: ").strip()

    if not url.startswith(("http://", "https://")):
        print("[!] URL tidak valid.")
        sys.exit(1)

    print("\n[*] Mengambil data dari Raw URL...")

    try:
        text = fetch_raw(url)
    except Exception as e:
        print(f"[!] Gagal mengambil data: {e}")
        sys.exit(1)

    tokens = extract_tokens(text)
    unique = list(dict.fromkeys(tokens))

    print(f"[*] Ditemukan : {len(tokens)}")
    print(f"[*] Unik      : {len(unique)}")
    print("\n===== LIVE LOG =====")

    active_format = []
    invalid = []

    for i, token in enumerate(unique, 1):
        masked = token[:8] + "..." + token[-4:]
        print(f"[{i:03}] CHECKING  {masked}", flush=True)

        # Hanya validasi format, tidak mengirim token ke Telegram.
        if re.fullmatch(r'\d{6,12}:[A-Za-z0-9_-]{20,}', token):
            active_format.append(token)
            print(f"[{i:03}] ✓ VALID FORMAT", flush=True)
        else:
            invalid.append(token)
            print(f"[{i:03}] ✗ INVALID FORMAT", flush=True)

        time.sleep(0.05)

    with open(OUTPUT, "w", encoding="utf-8") as f:
        f.write("=== TOKENS HUNTER ===\n")
        f.write(f"Source: {url}\n\n")
        f.write("[VALID FORMAT]\n")
        for token in active_format:
            f.write(token + "\n")

        f.write("\n[INVALID FORMAT]\n")
        for token in invalid:
            f.write(token + "\n")

    print("\n===== RESULT =====")
    print(f"TOTAL         : {len(unique)}")
    print(f"VALID FORMAT  : {len(active_format)}")
    print(f"INVALID FORMAT: {len(invalid)}")
    print(f"\n[+] Hasil disimpan ke {OUTPUT}")

if __name__ == "__main__":
    main()
PY
