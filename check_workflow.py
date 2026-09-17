import sys
import json

data = json.load(sys.stdin)
w = data['data'][0]['workflow']
print('Nodes with widgets_values (user configurable):')
count = 0
for n in w['nodes']:
    wv = n.get('widgets_values')
    wvn = n.get('widgets_values_named', {})
    # Filter out internal/GetNode values
    if wv and len(wv) > 0:
        # Check if it's a user-configurable value (not internal references)
        is_internal = any(v in ['pos', 'neg', 'model', 'length', 'Video VAE', 'Audio VAE', 'upscale model', 'Video_Audio', 'Video_Info', 'video_input', 'img2', 'Image1', 'Image2', 'ad6'] for v in wv)
        if not is_internal:
            print(f'  Node {n["id"]} ({n["type"]}) - title: {n.get("title", "N/A")}')
            print(f'    widgets_values: {wv}')
            print(f'    widgets_values_named: {wvn}')
            print(f'    inputs: {n.get("inputs")}')
            print()
            count += 1
            if count >= 20:
                break