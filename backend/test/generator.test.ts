// Unit coverage for generator input normalization. The client uses public camelCase
// names and compact ratio ids; workflow templates use ComfyUI-facing names/labels.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generatorService, normalizeGeneratorInputs } from '../src/services/generator.js';

describe('generator input normalization', () => {
  test('maps the T2V-LTX public payload to the workflow input keys and labels', () => {
    const config = generatorService.getRawWorkflowConfig('T2V-LTX');
    assert.ok(config, 'T2V-LTX workflow config should be available');

    const normalized = normalizeGeneratorInputs(config, {
      prompt:
        'A lone person walks barefoot along the wet shoreline at sunrise, leaving footprints behind them.',
      aspectRatio: '9:16',
      duration: 5,
      megapixels: 0.9,
    });

    assert.equal(normalized.prompt, 'A lone person walks barefoot along the wet shoreline at sunrise, leaving footprints behind them.');
    assert.equal(normalized.aspect_ratio, '9:16 (Portrait Widescreen)');
    assert.equal(normalized.duration, 5);
    assert.equal(normalized.mp, 0.9);
  });

  test('continues to accept workflow-native input names and full ratio labels', () => {
    const config = generatorService.getRawWorkflowConfig('T2V-LTX');
    assert.ok(config, 'T2V-LTX workflow config should be available');

    const normalized = normalizeGeneratorInputs(config, {
      aspect_ratio: '16:9 (Widescreen)',
      mp: 1.2,
      duration: 8,
      prompt: 'native input names',
    });

    assert.equal(normalized.aspect_ratio, '16:9 (Widescreen)');
    assert.equal(normalized.mp, 1.2);
    assert.equal(normalized.duration, 8);
    assert.equal(normalized.prompt, 'native input names');
  });
});
