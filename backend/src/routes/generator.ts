// Routes: Generator endpoints (I2V/T2V/T2I generation + workflow configuration).
// These are mounted at the API root, so the paths are absolute from `/api`.
import { Router } from 'express';
import { generatorController } from '../controllers/generator.js';

const router = Router();
const g = generatorController;

router.post('/generate-i2v', g.generateI2V.bind(g));
router.post('/generate-t2v', g.generateT2V.bind(g));
router.post('/generate-t2i', g.generateT2I.bind(g));
router.get('/generator-config', g.getGeneratorConfig.bind(g));

export default router;