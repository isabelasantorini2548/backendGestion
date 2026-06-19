// routes/facultades.js
const express = require('express');
const router = express.Router();
const { getModels } = require('../models');

// GET /facultades - Obtener todas las facultades
router.get('/', async (req, res) => {
  try {
    const models = getModels();
    const Facultad = models.Facultad || models.facultad;
    
    if (!Facultad) {
      return res.status(404).json({ message: 'Modelo Facultad no encontrado' });
    }
    
    const facultades = await Facultad.findAll({
      order: [['nombre', 'ASC']] // Ordenar alfabéticamente
    });
    
    res.json(facultades);
  } catch (error) {
    console.error('Error fetching facultades:', error);
    res.status(500).json({ 
      message: 'Error al obtener facultades', 
      error: error.message 
    });
  }
});

module.exports = router;