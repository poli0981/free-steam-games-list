def short_desc(full_desc):
    if not full_desc or full_desc == 'N/A':
        return 'N/A'
    sentence = full_desc.split('.')[0].strip()
    return sentence + '.' if sentence else full_desc[:100] + '...'

def fancy_name(name, max_len=50):
    if len(name) <= max_len:
        return name
    words = name.split()
    if len(words) > 5:
        abbr = ''.join(w[0].upper() for w in words if w)
        return f"{name[:30]}... ({abbr})"
    return name[:47] + '...'