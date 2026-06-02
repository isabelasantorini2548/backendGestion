// routes/notificacionesRoutes.js
const { Router } =require ('express');
const {
  getUserNotifications,
  read,
  getUnreadCount,
  sendNotification,
} = require('../controllers/notificationController.js');
const {protect} =require('../middleware/authMiddleware.js'); 

const router = Router();

router.get('/', protect, getUserNotifications);
router.patch('/:id/read', protect, read);
router.get('/unread-count', protect, getUnreadCount);

module.exports = router;