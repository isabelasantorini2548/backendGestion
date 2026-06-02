const { Router } = require('express');
const { createRecurso,getRecursos,updateRecurso,deleteRecurso } = require ('../controllers/recursoController.js');
const { protect } =require('../middleware/authMiddleware.js'); 

const router = Router();

router.post('/', protect, createRecurso); 
router.get('/', protect, getRecursos);
router.put('/:id',updateRecurso);
router.delete('/:id',deleteRecurso);

module.exports = router;