import sys
import json

data = json.load(sys.stdin)
w = data['data'][0]['workflow']

for n in w['nodes']:
    wvn = n.get('widgets_values_named', {})
    if wvn:
        for k, v in wvn.items():
            if isinstance(v, dict):
                print(f'Node {n["id"]} - {k}: {v} (type: {type(v).__name__})')