import { Router } from 'express';
import { jobController } from '../controllers/job.js';

const router = Router();

router.post('/', jobController.createJob.bind(jobController));
router.get('/', jobController.getJobs.bind(jobController));
router.get('/:id', jobController.getJob.bind(jobController));
router.get('/:id/status', jobController.getJobStatus.bind(jobController));
router.patch('/:id', jobController.updateJob.bind(jobController));
router.post('/:id/process', jobController.processJob.bind(jobController));
router.post('/:id/cancel', jobController.cancelJob.bind(jobController));
router.delete('/:id', jobController.deleteJob.bind(jobController));

export default router;