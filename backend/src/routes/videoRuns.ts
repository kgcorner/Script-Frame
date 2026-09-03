// Routes: ScriptFrame video-run lifecycle (VIDEO_GENERATION_PROCESS.md).
// Static sub-paths are registered before parameterized /:id routes (project convention,
// see SCRIPTFRAME_WORKFLOW convention note in PROJECT_UNDERSTANDING.md §5.1).
import { Router } from 'express';
import { videoRunController } from '../controllers/videoRun.js';

const router = Router();
const v = videoRunController;

// --- Collection: initiate ---
router.post('/', v.initiateVideoRun.bind(v));

// --- Per-run ---
router.get('/:id', v.getVideoRun.bind(v));
router.patch('/:id/approve', v.approve.bind(v));
router.patch('/:id/request-change', v.requestChange.bind(v));
router.patch('/:id/edit-story', v.editStory.bind(v));
router.patch('/:id/restart', v.restart.bind(v));
router.get('/:id/video', v.getFinalVideo.bind(v));
router.get('/:id/review', v.getReview.bind(v));

// --- Per-clip (review + post-generation) ---
router.patch('/:id/clips/:clipId', v.updateClip.bind(v));
router.post('/:id/clips/:clipId/retry', v.retryClip.bind(v));
router.post('/:id/clips/:clipId/cancel', v.cancelClip.bind(v));
router.patch('/:id/clips/reorder', v.reorderClips.bind(v));

export default router;
