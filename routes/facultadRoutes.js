const  express = require('express');
const router = express.Router()
const  { getFacultades} = require('../controllers/facultadController.js');
const  { protect } = require('../middleware/authMiddleware.js');

router.get('/facultades', protect, getFacultades);

module.exports = router;