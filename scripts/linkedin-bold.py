import re, sys
def bold(s):
    out = []
    for ch in s:
        o = ord(ch)
        if 'A' <= ch <= 'Z': out.append(chr(0x1D5D4 + o - 65))
        elif 'a' <= ch <= 'z': out.append(chr(0x1D5EE + o - 97))
        elif '0' <= ch <= '9': out.append(chr(0x1D7EC + o - 48))
        else: out.append(ch)
    return ''.join(out)
src = open(sys.argv[1]).read().strip()
rich = re.sub(r'\*\*(.+?)\*\*', lambda m: bold(m.group(1)), src, flags=re.S)
plain = re.sub(r'\*\*(.+?)\*\*', r'\1', src, flags=re.S)
open(sys.argv[2], 'w').write(rich + '\n')
open(sys.argv[3], 'w').write(plain + '\n')
u16 = sum(2 if ord(c) > 0xFFFF else 1 for c in rich)
print(f'bolded version: {len(rich)} code points, {u16} UTF-16 units (LinkedIn counts these)')
print(f'plain version : {len(plain)} characters')
print(f'bold spans    : {len(re.findall(r"\*\*(.+?)\*\*", src))}')
