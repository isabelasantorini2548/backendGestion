const { getModels } = require('../models/index.js');
const { Op } = require('sequelize');
const asyncHandler = require('express-async-handler');

const getDashboardStats = asyncHandler(async (req, res) => {
  try {
    const models = getModels();
    const { User, Evento, sequelize } = models;

    // 1. Usuarios activos (Habilitado es string '1')
    const activeUsers = await User.count({ where: { habilitado: '1' } });
    const totalEvents = await Evento.count();

    // 2. Usuarios nuevos (Usamos 'createdAt' que suele ser el estándar de Sequelize para User)
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const [resultadoNuevos] = await sequelize.query(
      `SELECT COUNT(*) as total FROM usuario WHERE "created_at" >= :inicioMes`, 
      { replacements: { inicioMes }, type: sequelize.QueryTypes.SELECT }
    );
    const usuariosNuevosEsteMes = parseInt(resultadoNuevos?.total || 0);

    // 3. Conteos por estado (Cambiamos created_at por fechaevento)
    const todosLosEventos = await Evento.findAll({
      attributes: ['estado', 'fechaevento']
    });

    const estadoCounts = todosLosEventos.reduce((acc, evento) => {
      const estado = evento.estado || 'sin_estado';
      acc[estado] = (acc[estado] || 0) + 1;
      return acc;
    }, {});

    const primerDiaDelMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const eventosAprobadosMes = todosLosEventos.filter(evento => {
      const fecha = new Date(evento.fechaevento);
      return evento.estado === 'aprobado' && fecha >= primerDiaDelMes;
    }).length;

    const tasaAprobacion = totalEvents > 0 
      ? Math.round(((estadoCounts.aprobado || 0) / totalEvents) * 100) 
      : 0;

    // 4. Eventos por Facultad (Mantenemos tu lógica SQL)
    let eventosPorFacultad = [];
    try {
      const result = await sequelize.query(`
        SELECT f.nombre_facultad as facultad, COUNT(e.idevento) as total
        FROM facultad f
        LEFT JOIN academico a ON f.facultad_id = a.facultad_id
        LEFT JOIN evento e ON a.idacademico = e.idacademico
        GROUP BY f.nombre_facultad ORDER BY total DESC
      `, { type: sequelize.QueryTypes.SELECT });
      eventosPorFacultad = result.map(r => ({ facultad: r.facultad, total: parseInt(r.total) }));
    } catch (e) { console.warn('Error Facultad:', e.message); }

    // 5. Eventos por día (Usamos fecha_aprobacion que sí existe)
    let eventosPorDia = [];
    try {
      const results = await sequelize.query(`
        SELECT DATE("fecha_aprobacion") as fecha, COUNT(*) as total
        FROM "evento"
        WHERE "fecha_aprobacion" >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY DATE("fecha_aprobacion") ORDER BY fecha ASC
      `, { type: sequelize.QueryTypes.SELECT });

      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const ds = d.toISOString().split('T')[0];
        const found = results.find(r => r.fecha === ds);
        eventosPorDia.push({ fecha: ds, total: found ? parseInt(found.total) : 0 });
      }
    } catch (e) { console.warn('Error Días:', e.message); }

    res.status(200).json({
      activeUsers, totalEvents, usuariosNuevosEsteMes, estadoCounts,
      eventosAprobadosMes, tasaAprobacion, systemStability: 99,
      eventosPorFacultad, eventosPorDia
    });
  } catch (error) {
    console.error('❌ Dashboard Error:', error);
    res.status(500).json({ error: error.message });
  }
});

const getMensualStats = asyncHandler(async (req, res) => {
  try {
    const { sequelize } = getModels();
    const result = await sequelize.query(`
      SELECT 
        TO_CHAR("fechaevento", 'YYYY-MM') AS mes, 
        COUNT(*) FILTER (WHERE "estado" = 'aprobado')::INTEGER AS aprobado,
        COUNT(*) FILTER (WHERE "estado" = 'pendiente')::INTEGER AS pendiente,
        COUNT(*) FILTER (WHERE "estado" = 'rechazado')::INTEGER AS rechazado,
        COUNT(*) AS total
      FROM "evento"
      WHERE "fechaevento" IS NOT NULL            
      GROUP BY TO_CHAR("fechaevento", 'YYYY-MM') 
      ORDER BY mes DESC;
    `, { type: sequelize.QueryTypes.SELECT });

    const reportes = result.map(row => ({
      mes: row.mes,
      totalEvents: parseInt(row.total),
      aprobado: row.aprobado,
      pendiente: row.pendiente,
      rechazado: row.rechazado,
      tasaAprobacion: row.total > 0 ? parseFloat(((row.aprobado / row.total) * 100).toFixed(1)) : 0
    }));

    res.status(200).json(reportes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const getHistoricalData = asyncHandler(async (req, res) => {
  try {
    const { Evento } = getModels();
    const now = new Date();
    const historical = [];

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const name = start.toLocaleString('es-ES', { month: 'short' });

      // IMPORTANTE: Cambiado created_at por fechaevento
      const eventos = await Evento.count({
        where: { fechaevento: { [Op.gte]: start, [Op.lt]: end } }
      });
      historical.push({ name, eventos });
    }
    res.status(200).json({ historical });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
const getMyDashboardStats = asyncHandler(async (req, res) => {
  try {
     console.log('🔍 req.user completo:', JSON.stringify(req.user, null, 2));
    
    const models = getModels();
    const { idusuario } = req.user;

    if (!idusuario) {
      return res.status(401).json({ error: 'Usuario no identificado' });
    }
    console.log('👤 idusuario:', idusuario);
    const { Evento, Academico } = models;

    const academicos = await Academico.findAll({
      where: { idusuario }
    });
      console.log('🎓 academicos encontrados:', JSON.stringify(academicos, null, 2));
    if (!academicos || academicos.length === 0) {
      return res.status(403).json({ error: 'No tienes perfil de académico registrado.' });
    }

    const idsAcademico = academicos.map(a => a.idacademico || a.idacademico).filter(Boolean);
     console.log('📋 idsAcademico:', idsAcademico);

    const totalEvents = await Evento.count({
      where: { idacademico: idsAcademico }
    });
     console.log('📅 totalEvents:', totalEvents);
    const eventosPorEstado = await Evento.findAll({
      attributes: ['estado','fechaevento'],
      where: { idacademico: idsAcademico }
    });

    const estadoCounts = {};
    eventosPorEstado.forEach(evento => {
      const estado = evento.estado || 'sin_estado';
      estadoCounts[estado] = (estadoCounts[estado] || 0) + 1;
    });

    const primerDiaDelMes = new Date();
    primerDiaDelMes.setDate(1);
    primerDiaDelMes.setHours(0, 0, 0, 0);

    const eventosAprobadosMes = eventosPorEstado.filter(evento => {
      const fechaEvento = new Date(evento.fechaevento);
      return evento.estado === 'aprobado' && fechaEvento >= primerDiaDelMes;
    }).length;

    const eventosAprobados = estadoCounts.aprobado || 0;
    const tasaAprobacion = totalEvents > 0 
      ? Math.round((eventosAprobados / totalEvents) * 100) 
      : 0;

    const stats = {
      totalEvents,
      estadoCounts,
      eventosAprobadosMes,
      tasaAprobacion,
    };

    res.status(200).json(stats);
    
  } catch (error) {
    console.error('❌ Error en getMyDashboardStats:', error);
    res.status(500).json({ 
      error: 'Error al cargar tus estadísticas',
      message: error.message 
    });
  }
});

const getMyHistoricalData = asyncHandler(async (req, res) => {
  try {
    const models = getModels();
    const { Evento, Academico } = models;
    const { idusuario } = req.user;

    const academicos = await Academico.findAll({ where: { idusuario } });
    if (!academicos || academicos.length === 0) return res.status(200).json({ historical: [] });
    
    const idsAcademico = academicos.map(a => a.idacademico || a.idacademico).filter(Boolean);

    const now = new Date();
    const historical = [];

    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const name = start.toLocaleString('es-ES', { month: 'short' });

      const eventos = await Evento.count({
        where: {
          idacademico: idsAcademico,
          fechaevento: { [Op.gte]: start, [Op.lt]: end } // <--- Cambio a fechaevento
        }
      });
      historical.push({ name, eventos });
    }
    res.status(200).json({ historical });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const getMyCommitteeEvents = asyncHandler(async (req, res) => {
  try {
    if (!req.user?.idusuario) return res.status(401).json({ error: 'No autorizado' });

    const { idusuario } = req.user;
    const { sequelize, Evento } = getModels();

    const DIAS_A_MOSTRAR = 30; 
    const fechaLimite = new Date();
    fechaLimite.setDate(fechaLimite.getDate() - DIAS_A_MOSTRAR);

    // En la tabla 'comite', confirmamos que la columna es created_at con guion bajo
    const committeeRecords = await sequelize.query(
      `SELECT idevento, "created_at" FROM public.comite WHERE idusuario = :idusuario`,
      { replacements: { idusuario }, type: sequelize.QueryTypes.SELECT }
    );

    if (committeeRecords.length === 0) return res.status(200).json({ events: [] });

    const eventoIds = committeeRecords.map(record => record.idevento);

    // Ajustamos el findAll para usar fechaevento como filtro
    const events = await Evento.findAll({
      where: { 
        idevento: eventoIds,
        fechaevento: { [Op.gte]: fechaLimite } // <--- Cambio a fechaevento
      },
      attributes: ['idevento', 'nombreevento', 'descripcion', 'fechaevento', 'estado'],
      order: [['fechaevento', 'DESC']] // <--- Ordenar por fechaevento
    });

    const eventsWithAssignment = events.map(event => {
      const assignment = committeeRecords.find(r => r.idevento === event.idevento);
      return {
        ...event.get({ plain: true }),
        assignedAt: assignment?.created_at,
        role: 'comité'
      };
    });

    res.status(200).json({ events: eventsWithAssignment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
const myEvent= asyncHandler(async (req, res) => {
  if (!req.user || !req.user.idusuario) {
      console.error('Usuario no autenticado o req.user faltante');
      return res.status(401).json({ 
        error: 'No autorizado. Por favor inicia sesión nuevamente.',
        debug: { hasUser: !!req.user, user: req.user }
      });
    }
})
module.exports = {
  getDashboardStats,
  getMensualStats,
  getHistoricalData,
  getMyDashboardStats,
  getMyHistoricalData,
  getMyCommitteeEvents,
  myEvent
};