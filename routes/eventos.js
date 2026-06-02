const  express = require('express');
const  { Op } = require('sequelize');
const  { getModels } = require('../models/index.js');
const  { 
  createEvento,
  getAllEventos, 
  getEventoById,
  updateEvento, 
  deleteEvento,
  getEventosNoAprobados,
  getEventosAprobados,
  aprobarEvento,rechazarEvento,
  getDashboardStats,
  getHistoricalData,
  getEventosAprobadosPorFacultad,
  getEventosRechazados
 
  //getEventosPendientesPorArea
  } = require('../controllers/proyectoController.js');
  //import { getEventDetailsById } from '../controllers/evento.js';
const  {protect,authorize} = require('../middleware/authMiddleware.js');
const router = express.Router();

router.use((req, res, next) => {
  console.log(`[RUTA] ${req.method} ${req.path} - Params:`, req.params, '- Body:', req.body);
  next();
});

router.get('/pendientes',protect, getEventosNoAprobados);
router.get('/aprobados',protect, getEventosAprobados);
router.get('/aprobados-por-facultad',protect, getEventosAprobadosPorFacultad);
router.get('/dashboard/stats', protect, getDashboardStats);
router.get('/dashboard/historical', protect, getHistoricalData);
router.get('/rechazados',protect, getEventosRechazados);
//router.get('/details/:id', getEventDetailsById);


//router.get('/listar-pendientes', pendientes); // si necesitas esta ruta
//router.get('/pendientes',protect, getEventosPendientesPorArea);
router.put('/:id/approve', aprobarEvento);
router.put('/:id/reject',deleteEvento);
router.put('/:id', updateEvento);
//router.delete('/:id', deleteEvento);
router.post('/',protect, createEvento);
router.get('/', getAllEventos);
router.get('/:id',protect, getEventoById);
//router.get('/mios/aprobados',protect, getAprobados);


//router.get('/debug/:id',debugEventoById);



//router.get('/pendientes',pendientes);

module.exports = router;