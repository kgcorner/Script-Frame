// Routes: serve stored generation artifacts.
// Artifacts are permanent: nothing here (or anywhere in the backend) deletes them.
import { Router } from 'express';
import { artifactController } from '../controllers/artifact.js';

const router = Router();

// GET /artifact/:name -> immutable media (byte-range capable).
router.get('/:name', artifactController.getArtifact.bind(artifactController));

export default router;