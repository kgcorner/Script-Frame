import sys
import json

# Test with history workflow format
data = json.load(sys.stdin)
w = data['data'][0]['workflow']

# This mimics the extractInputs function logic
def extractInputs(definition):
    fields = []
    
    # Check if this is a ComfyUI format workflow (has 'nodes' array)
    if definition.get('nodes') and isinstance(definition['nodes'], list):
        extractInputsFromComfyUI(definition['nodes'], fields)
    else:
        # Original format (local workflows / history)
        extractInputsFromLocal(definition, fields)
    
    # Sort by nodeId then inputName for consistent display
    fields.sort(key=lambda x: (x['nodeId'], x['inputName']))
    
    return fields

def extractInputsFromLocal(definition, fields):
    for nodeId, node in definition.items():
        if node.get('inputs'):
            nodeTitle = node.get('_meta', {}).get('title') or node.get('class_type') or nodeId
            for inputName, defaultValue in node['inputs'].items():
                key = f'{nodeId}:{inputName}'
                # Infer type from default value
                type_ = 'string'
                if isinstance(defaultValue, (int, float)): type_ = 'number'
                elif isinstance(defaultValue, bool): type_ = 'boolean'
                elif isinstance(defaultValue, str):
                    if defaultValue.endswith(('.png', '.jpg', '.jpeg', '.mp4', '.webm')): type_ = 'file'
                
                fields.append({
                    'key': key,
                    'nodeId': nodeId,
                    'nodeTitle': nodeTitle,
                    'inputName': inputName,
                    'defaultValue': defaultValue,
                    'type': type_,
                    'isPrimary': False
                })

def extractInputsFromComfyUI(nodes, fields):
    # Known internal values that shouldn't be exposed as user inputs
    internalValues = {
        'pos', 'neg', 'model', 'length', 'Video VAE', 'Audio VAE', 
        'upscale model', 'Video_Audio', 'Video_Info', 'video_input',
        'img1', 'img2', 'img3', 'img4', 'img5', 'Image1', 'Image2', 'ad6',
        'width', 'height', 'FPS', 'ltx_latent_df'
    }
    
    for node in nodes:
        nodeId = str(node['id'])
        nodeTitle = node.get('title') or node.get('type') or nodeId
        widgetsValuesNamed = node.get('widgets_values_named', {})
        
        # Extract user-configurable widget values (only simple types: string, number, boolean)
        for widgetName, defaultValue in widgetsValuesNamed.items():
            # Skip internal/system values
            if isinstance(defaultValue, str) and defaultValue in internalValues:
                continue
            
            # Skip complex objects (widget configurations like videopreview, divider, etc.)
            if not isinstance(defaultValue, (str, int, float, bool)):
                continue
            
            key = f'{nodeId}:{widgetName}'
            # Infer type from default value
            type_ = 'string'
            if isinstance(defaultValue, (int, float)): type_ = 'number'
            elif isinstance(defaultValue, bool): type_ = 'boolean'
            elif isinstance(defaultValue, str):
                if defaultValue.endswith(('.png', '.jpg', '.jpeg', '.mp4', '.webm')): type_ = 'file'
            
            fields.append({
                'key': key,
                'nodeId': nodeId,
                'nodeTitle': nodeTitle,
                'inputName': widgetName,
                'defaultValue': defaultValue,
                'type': type_,
                'isPrimary': False
            })

fields = extractInputs(w)

print(f"Extracted {len(fields)} input fields:")
for f in fields[:30]:
    print(f"  Node {f['nodeId']} ({f['nodeTitle']}) - {f['inputName']}: {f['defaultValue']} ({f['type']})")

if len(fields) > 30:
    print(f"  ... and {len(fields) - 30} more fields")