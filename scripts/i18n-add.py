"""Add or update translations in src/lib/i18n/messages.json.

Input lines: English | Deutsch | Italiano | العربية, with {} for each lifted value (a number, date, amount or name), in the
same order in every language. Usage: python3 scripts/i18n-add.py new-lines.txt
"""
import json, re, sys

PATH = "src/lib/i18n/messages.json"

def number(text):
    count = [-1]
    def next_slot(_):
        count[0] += 1
        return "{%d}" % count[0]
    return re.sub(r"\{\}", next_slot, text)

messages = json.load(open(PATH, encoding="utf8"))
problems = []
for n, line in enumerate(open(sys.argv[1], encoding="utf8"), 1):
    line = line.rstrip("\n")
    if not line.strip():
        continue
    parts = [p.strip() for p in line.split(" | ")]
    if len(parts) != 4:
        problems.append((n, "needs four columns", line[:60]))
        continue
    key = number(parts[0])
    slots = len(re.findall(r"\{\d+\}", key))
    values = [number(v) if "{}" in v else v for v in parts[1:]]
    if any(len(set(re.findall(r"\{\d+\}", v))) != slots for v in values):
        problems.append((n, "placeholders differ", parts[0][:60]))
        continue
    messages[key] = values
json.dump(messages, open(PATH, "w", encoding="utf8"), ensure_ascii=False, indent=0, sort_keys=True)
print("entries", len(messages), "problems", len(problems))
for p in problems:
    print(p)
