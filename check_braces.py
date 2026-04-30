import sys
sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

with open('static/js/gm/02-characters.js', 'r', encoding='utf-8') as f:
    content = f.read()

i = 0
balance = 0
in_string = None
in_template_expr = False
line = 1

while i < len(content):
    ch = content[i]
    if ch == '\n':
        line += 1
    if in_string is not None:
        if in_string == '`' and ch == '$' and i + 1 < len(content) and content[i+1] == '{':
            in_template_expr = True
            i += 2
            balance += 1
            continue
        if in_template_expr and ch == '}':
            in_template_expr = False
            balance -= 1
            i += 1
            continue
        if ch == '\\':
            i += 2
            continue
        if ch == in_string:
            in_string = None
        i += 1
        continue
    
    if ch in ('"', "'", '`'):
        in_string = ch
        i += 1
        continue
    
    if ch == '{':
        balance += 1
    elif ch == '}':
        balance -= 1
    
    if balance < 0:
        print(f'Negative balance at line {line}')
        break
    
    i += 1

print(f'Final balance: {balance}')
