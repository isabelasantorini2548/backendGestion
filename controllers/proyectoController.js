const { getModels } = require('../models/index');
const { Op } = require('sequelize');
const asyncHandler = require('express-async-handler');
const { sendNotification } = require('./notificationController.js');

// --- CONSTANTES ---
const OBJETIVO_TYPES = {
  modeloPedagogico: 1, posicionamiento: 2, internacionalizacion: 3,
  rsu: 4, fidelizacion: 5, otro: 6
};
const OTRO_TIPO_ID = 6;
const OTRO_SEGMENTO_ID = 5;

// --- FUNCIONES AUXILIARES ---
const safeJsonParse = (jsonString, defaultValue = {}) => {
  try {
    if (!jsonString) return defaultValue;
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn('JSON parse error:', error.message);
    return defaultValue;
  }
};


const createEvento = async (req, res) => {
  let models;
  try {
    models = getModels();
  } catch (e) {
    console.error('❌ Models no inicializados:', e.message);
    return res.status(500).json({ message: 'Servidor no listo, reintenta en unos segundos.' });
  }

  const { Evento, Resultado, Fase, Presupuesto, Egreso, Ingreso } = models;
  const sequelize = models.sequelize;

  if (!sequelize) {
    return res.status(500).json({ message: 'Conexión a base de datos no disponible.' });
  }

  const t = await sequelize.transaction();

  try {
    const data = req.body;
    console.log('Datos recibidos:', JSON.stringify(data, null, 2));

    if (!data.nombreevento || !data.fechaevento) {
      await t.rollback();
      return res.status(400).json({ message: 'Campos requeridos: nombreevento, fechaevento' });
    }

    // 1. CREAR EVENTO
    const nuevoEvento = await Evento.create({
      nombreevento: data.nombreevento,
      lugarevento: data.lugarevento || 'Por definir',
      fechaevento: data.fechaevento,
      horaevento: data.horaevento,
      idacademico: req.user.idusuario,
      idclasificacion: data.idclasificacion || null,
      idsubcategoria: data.idsubcategoria || null,
      estado: 'pendiente',
    }, { transaction: t });

    const nuevoEventoId = nuevoEvento.idevento;
    console.log('✅ Evento creado con ID:', nuevoEventoId);

    // 2. FASE MAESTRA
    try {
      const faseMaestra = await Fase.findOne({
        where: { nrofase: 1 },
        attributes: ['idfase', 'nrofase'],
        transaction: t
      });
      if (faseMaestra) {
        nuevoEvento.idfase = faseMaestra.idfase;
        await nuevoEvento.save({ transaction: t });
      }
    } catch (faseError) {
      console.warn('⚠️ No se pudo asignar fase:', faseError.message);
    }

    // 3. TIPOS DE EVENTO
    // evento_tipos: (idevento, idtipoevento, texto_personalizado)
    if (Array.isArray(data.tipos_de_evento) && data.tipos_de_evento.length > 0) {
      for (const tipo of data.tipos_de_evento) {
        await sequelize.query(
          'INSERT INTO evento_tipos (idevento, idtipoevento, texto_personalizado) VALUES (?, ?, ?)',
          { replacements: [nuevoEventoId, tipo.id, tipo.texto_personalizado || null], transaction: t }
        );
      }
      console.log('✅ Tipos de evento insertados:', data.tipos_de_evento.length);
    }

    if (Array.isArray(data.objetivos) && data.objetivos.length > 0) {
      let primerIdObjetivo = null; // Variable segura para argumentación global

      for (const objetivo of data.objetivos) {
        const idtipoobjetivo = typeof objetivo === 'number' ? objetivo : objetivo.id;
        const texto = typeof objetivo === 'object' ? (objetivo.texto_personalizado || null) : null;

        // 4.1 Insertar en tabla 'objetivos'
        const [result] = await sequelize.query(
          'INSERT INTO objetivos (idtipoobjetivo, texto_personalizado) VALUES (?, ?) RETURNING idobjetivo',
          { replacements: [idtipoobjetivo, texto], transaction: t }
        );

        // ✅ FIX: Validar que obtuvimos el ID antes de continuar
        const nuevoIdObjetivo = result[0]?.idobjetivo;
        if (!nuevoIdObjetivo) {
          console.warn('⚠️ No se pudo obtener el ID del objetivo creado');
          continue;
        }

        // Guardamos el primer ID para vincular la argumentación global si existe
        if (!primerIdObjetivo) primerIdObjetivo = nuevoIdObjetivo;

        // 4.2 Vincular en 'evento_objetivos'
        await sequelize.query(
          'INSERT INTO evento_objetivos (idevento, idobjetivo, texto_personalizado) VALUES (?, ?, ?)',
          { replacements: [nuevoEventoId, nuevoIdObjetivo, texto], transaction: t }
        );

        // 4.3 Insertar ARGUMENTACIÓN (Solo una vez, vinculada al primer objetivo)
          if (data.argumentacion?.trim() && nuevoIdObjetivo === primerIdObjetivo) {
          
          // ✅ FIX: Se eliminó 'ON CONFLICT' porque la tabla no tiene esa restricción única
          await sequelize.query(
            'INSERT INTO argumentacion (idobjetivo, texto_argumentacion) VALUES (?, ?)',
            { replacements: [nuevoIdObjetivo, data.argumentacion.trim()], transaction: t }
          );
          
          console.log('✅ Argumentación vinculada al objetivo ID:', nuevoIdObjetivo);
        }

        // 4.4 Vincular SEGMENTOS a ESTE objetivo
        if (Array.isArray(data.segmentos_objetivo) && data.segmentos_objetivo.length > 0) {
          for (const segmento of data.segmentos_objetivo) {
            await sequelize.query(
              'INSERT INTO objetivo_segmento (idobjetivo, idsegmento, texto_personalizado) VALUES (?, ?, ?)',
              { replacements: [nuevoIdObjetivo, segmento.id, segmento.texto_personalizado || null], transaction: t }
            );
          }
        }
      }
      console.log('✅ Objetivos, argumentación y segmentos procesados');
    }

    // 5. OBJETIVOS PDI
    // evento_pdi: (idevento_pdi, idevento, descripcion)
    if (Array.isArray(data.objetivos_pdi) && data.objetivos_pdi.length > 0) {
      const descripcionesValidas = data.objetivos_pdi.filter(d => d && d.trim() !== '');
      for (const descripcion of descripcionesValidas) {
        await sequelize.query(
          'INSERT INTO evento_pdi (idevento, descripcion) VALUES (?, ?)',
          { replacements: [nuevoEventoId, descripcion], transaction: t }
        );
      }
      console.log('✅ Objetivos PDI insertados:', descripcionesValidas.length);
    }
  
    // 6. RESULTADOS ESPERADOS
    // resultado: (idresultados_esperados, idevento, satisfaccion_real, otros_resultados, participacion_esperada, satisfaccion_esperada)
    const resultados = typeof data.resultados_esperados === 'string'
      ? JSON.parse(data.resultados_esperados)
      : (data.resultados_esperados || {});

    await sequelize.query(
      'INSERT INTO resultado (idevento, participacion_esperada, satisfaccion_esperada, otros_resultados) VALUES (?, ?, ?, ?)',
      {
        replacements: [
          nuevoEventoId,
          parseInt(resultados.participacion, 10) || 0,
          resultados.satisfaccion || null,
          resultados.otro || null
        ],
        transaction: t
      }
    );
    console.log('✅ Resultados esperados insertados');

    // 7. RECURSOS EXISTENTES
    // evento_recurso: (idevento, idrecurso, cantidad, observaciones, fecha)
    if (Array.isArray(data.recursos_existentes) && data.recursos_existentes.length > 0) {
      for (const idrecurso of data.recursos_existentes) {
        await sequelize.query(
          'INSERT INTO evento_recurso (idevento, idrecurso) VALUES (?, ?)',
          { replacements: [nuevoEventoId, idrecurso], transaction: t }
        );
      }
      console.log('✅ Recursos existentes vinculados:', data.recursos_existentes.length);
    }

    // 8. RECURSOS NUEVOS
    if (Array.isArray(data.recursos_nuevos) && data.recursos_nuevos.length > 0) {
      for (const recurso of data.recursos_nuevos) {
        const [result] = await sequelize.query(
          'INSERT INTO recurso (nombre_recurso, recurso_tipo, cantidad, habilitado) VALUES (?, ?, ?, ?) RETURNING idrecurso',
          { replacements: [recurso.nombre_recurso, recurso.recurso_tipo, recurso.cantidad || 1, true], transaction: t }
        );
        const nuevoIdRecurso = result[0]?.idrecurso;
        if (nuevoIdRecurso) {
          await sequelize.query(
            'INSERT INTO evento_recurso (idevento, idrecurso) VALUES (?, ?)',
            { replacements: [nuevoEventoId, nuevoIdRecurso], transaction: t }
          );
        }
      }
      console.log('✅ Recursos nuevos creados:', data.recursos_nuevos.length);
    }

    // 9. PRESUPUESTO
    if (data.presupuesto) {
      const presupuesto = await Presupuesto.create({
        idevento: nuevoEventoId,
        total_egresos: data.presupuesto.total_egresos || 0,
        total_ingresos: data.presupuesto.total_ingresos || 0,
        balance: data.presupuesto.balance || 0,
      }, { transaction: t });

      const egresosValidos = (data.presupuesto.egresos || []).filter(e => e.descripcion?.trim());
      if (egresosValidos.length > 0) {
        await Egreso.bulkCreate(
          egresosValidos.map(e => ({
            idpresupuesto: presupuesto.idpresupuesto,
            descripcion: e.descripcion,
            cantidad: parseFloat(e.cantidad) || 0,
            precio_unitario: parseFloat(e.precio_unitario) || 0,
            total: parseFloat(e.total) || 0,
          })),
          { transaction: t }
        );
      }

      const ingresosValidos = (data.presupuesto.ingresos || []).filter(i => i.descripcion?.trim());
      if (ingresosValidos.length > 0) {
        await Ingreso.bulkCreate(
          ingresosValidos.map(i => ({
            idpresupuesto: presupuesto.idpresupuesto,
            descripcion: i.descripcion,
            cantidad: parseFloat(i.cantidad) || 0,
            precio_unitario: parseFloat(i.precio_unitario) || 0,
            total: parseFloat(i.total) || 0,
          })),
          { transaction: t }
        );
      }
      console.log('✅ Presupuesto insertado');
    }

    // 10. COMITÉ
    // comite: (created_at, idevento, idusuario)
    if (Array.isArray(data.comite) && data.comite.length > 0) {
      for (const idusuario of data.comite) {
        await sequelize.query(
          'INSERT INTO comite (idevento, idusuario, created_at) VALUES (?, ?, NOW())',
          { replacements: [nuevoEventoId, idusuario], transaction: t }
        );
      }
      console.log('✅ Comité insertado:', data.comite.length, 'miembros');
    }

    await t.commit();
    if (Array.isArray(data.comite) && data.comite.length > 0) {
  for (const idusuario of data.comite) {
    try {
      await sendNotification({
        idusuario: idusuario,   // ← un ID a la vez, no el array completo
        titulo: 'Nuevo evento en tu comité',
        mensaje: `Se ha creado un nuevo evento: "${nuevoEvento.nombreevento}". Por favor, revísalo lo antes posible.`,
        tipo: 'nuevo_evento'
      });
    } catch (notifError) {
      // No bloquear si falla la notificación
      console.warn(`⚠️ No se pudo enviar notificación a usuario ${idusuario}:`, notifError.message);
    }
  }
}

    return res.status(201).json({
      message: 'Evento creado exitosamente',
      idevento: nuevoEventoId
    });

    

  } catch (error) {
    if (!t.finished) {
      await t.rollback();
    }
    console.error('❌ Error en la transacción al crear el evento:', error);
    return res.status(500).json({
      message: 'Error interno del servidor al crear el evento.',
      error: error.message,
      sql: error.parent?.sql || null
    });
  
  } 
};
const getAllEventos = async (req, res) => {
  const models = getModels();
  const sequelize = models.sequelize;
  const {Evento, User,Fase} = models;

  const eventos = await Evento.findAll({
    order: [['fechaevento', 'ASC'], ['horaevento', 'ASC']],
    attributes: { exclude: ['organizerId', 'categoryId', 'locationId'] }
  });

  const baseUrl = `${req.protocol}://${req.get('host')}/uploads/`;
  const eventosConUrl = eventos.map(evento => {
    const eventoData = evento.get({ plain: true });
    eventoData.imagenUrl = eventoData.imagen ? `${baseUrl}${eventoData.imagen}` : null;
    return eventoData;
  });
  res.status(200).json(eventosConUrl);
};
const fetchAllEvents = async () => {
  const models = getModels();
  const Evento = models.Evento;
  try {
    const eventos = await Evento.findAll({
      attributes: [
        'idevento',
        'nombreevento',
        'fechaevento',
        'horaevento'
      ],
      order: [['fechaevento', 'ASC'], ['horaevento', 'ASC']],
    });
    return eventos;
  } catch (error) {
    console.error('Error in fetchAllEvents:', error);
    throw error;
  }
};

const getEventosRechazados = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Evento, User, Academico, Facultad } = models;
  
  try {
    const userId = req.user.idusuario;
    const userRole = req.user.role;
    let eventos = [];
    
    if (userRole === 'admin' || userRole === 'daf') {
      eventos = await Evento.findAll({
        where: { estado: 'rechazado' },
        distinct: true,
        attributes: { include: ['idfase', 'razon_rechazo', 'fecha_rechazo'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email'],
          include: [{
            model: Academico,
            as: 'academico',
            attributes: ['facultad_id'],
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }],
        order: [['fecha_rechazo', 'DESC']]
      });
    } else if (userRole === 'academico') {
      eventos = await Evento.findAll({
        where: { 
          estado: 'rechazado',
          idacademico: userId 
        },
        distinct: true,
        attributes: { include: ['idfase', 'razon_rechazo', 'fecha_rechazo'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat']
        }],
        order: [['fecha_rechazo', 'DESC']]
      });
    } else {
      return res.status(403).json({ message: 'Acceso denegado' });
    }
    
    const eventosFormateados = eventos.map(event => {
      const creador = event.academicoCreador;
      const facultadNombre = creador?.academico?.facultad?.nombre_facultad || 'Sin facultad';
      
      return {
        idevento: event.idevento,
        nombreevento: event.nombreevento || 'Sin título',
        descripcion: event.descripcion || '',
        fechaevento: event.fechaevento 
      ? new Date(event.fechaevento).toISOString()  // Convertir a ISO string
      : null,
        horaevento: event.horaevento || 'N/A',
        lugarevento: event.lugarevento || 'Sin ubicación',
        estado: event.estado,
        razon_rechazo: event.razon_rechazo || 'Sin motivo especificado',
        fecha_rechazo: event.fecha_rechazo ? new Date(event.fecha_rechazo).toLocaleDateString('es-ES') : null,
        idacademico: event.idacademico,
        academico: creador ? {
          id: creador.idusuario,
          nombre: `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim()
        } : null,
        facultad: facultadNombre,
        created_at: event.created_at,
        updated_at: event.updated_at
      };
    });
    
    return res.status(200).json(eventosFormateados);
    
  } catch (error) {
    console.error('❌ Error en getEventosRechazados:', error);
    return res.status(500).json({ 
      error: 'Error al cargar eventos rechazados',
      details: error.message 
    });
  }
});
const getEventoById = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Evento,Fase,Resultado, User, Comite, Objetivo, ObjetivoPDI, Segmento, Recurso, Actividad, Servicio } = models;
   const sequelize = Evento.sequelize;
  try {
    const { id } = req.params;
    const eventIdNum = parseInt(id, 10);

    if (isNaN(eventIdNum)) {
      return res.status(400).json({ message: 'ID de evento inválido' });
    }

    // 1. Obtener el evento principal
    const evento = await Evento.findByPk(eventIdNum, {
      include: [
        {
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email', 'role'],
          required: false
        },
        {
          model: Fase,
          as: 'fases',
          attributes: ['nrofase']
        }
      ]
    });

    if (!evento) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

      const actividades = await Actividad.findAll({
        where: { idevento: eventIdNum },
        attributes: ['nombre', 'responsable', 'fecha_inicio', 'fecha_fin', 'tipo']
      });

      const servicios = await Servicio.findAll({
        where: { idevento: eventIdNum },
        attributes: ['nombreservicio', 'fechadeentrega', 'caracteristicas', 'observaciones']
      });

    // Resto de tus consultas existentes (tipos de evento, resultados, etc.)
    const [tiposDeEvento] = await sequelize.query(
      `SELECT et.idevento,t."nombretipo", et."texto_personalizado"
   FROM "evento_tipos" et
   JOIN "tipos_de_evento" t ON et."idtipoevento" = t."idtipoevento"
   WHERE et."idevento" = ?`,
      { replacements: [eventIdNum] }
    );

    const [resultados] = await sequelize.query(
      `SELECT "satisfaccion_esperada","otros_resultados","participacion_esperada", "satisfaccion_real" FROM "resultado"
    WHERE idevento=?`,
      { replacements: [eventIdNum] }
    );

    const [clasificacionData] = await sequelize.query(
      `SELECT 
      e."idevento",
      c."nombre_clasificacion",
      s."nombre_subcategoria",
      c."idclasificacion",
      s."idsubcategoria"
    FROM "evento" e
    LEFT JOIN "clasificacion_estrategica" c ON e."idclasificacion" = c."idclasificacion"
    LEFT JOIN "subcategoria" s ON c."idclasificacion" = s."idclasificacion"
    WHERE e."idevento" = ? LIMIT 1`,
      { replacements: [eventIdNum] }
    );
    const clasificacion = clasificacionData[0] || null;

    const [objetivosRaw] = await sequelize.query(
      `SELECT 
        eo."idevento",
         o."idobjetivo", 
         o."idtipoobjetivo", 
         o."texto_personalizado",
         t."nombre_objetivo",  
         s."nombre_segmento", 
         s."idsegmento",
         os."texto_personalizado" AS segmento_texto,
         a."texto_argumentacion" AS argumentacion
       FROM "evento_objetivos" eo
       JOIN "objetivos" o ON eo."idobjetivo" = o."idobjetivo"
       LEFT JOIN "tipos_objetivo" t ON o."idtipoobjetivo" = t."idtipoobjetivo" 
       LEFT JOIN "objetivo_segmento" os ON o."idobjetivo" = os."idobjetivo"
       LEFT JOIN "segmento" s ON os."idsegmento" = s."idsegmento"
       LEFT JOIN "argumentacion" a ON o."idobjetivo" = a."idobjetivo"
       WHERE eo."idevento" = ?`,
      { replacements: [eventIdNum] }
    );

    // Agrupar objetivos (tu lógica existente)
    const objetivosMap = new Map();
    objetivosRaw.forEach(row => {
      if (!objetivosMap.has(row.idobjetivo)) {
        objetivosMap.set(row.idobjetivo, {
          idobjetivo: row.idobjetivo,
          idtipoobjetivo: row.idtipoobjetivo,
          texto_personalizado: row.texto_personalizado,
          nombre_objetivo: row.nombre_objetivo, 
          pdi_descripciones: [],
          segmentos: [],
          argumentacion: row.argumentacion || null  
        });
      }
      const obj = objetivosMap.get(row.idobjetivo);
      if (row.idsegmento) obj.segmentos.push({
        idsegmento: row.idsegmento,
        nombre_segmento: row.nombre_segmento,
        texto_personalizado: row.segmento_texto
      });
    });

    const objetivos = Array.from(objetivosMap.values());
    
    const pdiRows = await sequelize.query(
      `SELECT "descripcion" FROM evento_pdi WHERE idevento = :idevento ORDER BY idevento_pdi ASC`,
      { 
        replacements: { idevento: eventIdNum },
        type: sequelize.QueryTypes.SELECT 
      }
    );
    const pdiIndependientes = pdiRows.map(row => row.descripcion);

    const [comiteRaw] = await sequelize.query(
      `SELECT u."idusuario", u."nombre", u."apellidopat", u."apellidomat", 
              u."email", u."role"
       FROM "comite" c
       JOIN "usuario" u ON c."idusuario" = u."idusuario"
       WHERE c."idevento" = ?`,
      { replacements: [eventIdNum] }
    );
    const comite = comiteRaw;

    const [recursosRaw] = await sequelize.query(
      `SELECT r."idrecurso", r."nombre_recurso", r."recurso_tipo", 
              r."descripcion", r."habilitado"
       FROM "evento_recurso" er
       JOIN "recurso" r ON er."idrecurso" = r."idrecurso"
       WHERE er."idevento" = ?`,
      { replacements: [eventIdNum] }
    );
    const recursos = recursosRaw;

    const [presupuestoData] = await sequelize.query(
    `SELECT p.*, e.descripcion as egreso_desc, e.cantidad as egreso_cant, 
            e.precio_unitario as egreso_precio, e.total as egreso_total,
            i.descripcion as ingreso_desc, i.cantidad as ingreso_cant,
            i.precio_unitario as ingreso_precio, i.total as ingreso_total
     FROM presupuesto p
     LEFT JOIN egreso e ON p.idpresupuesto = e.idpresupuesto
     LEFT JOIN ingreso i ON p.idpresupuesto = i.idpresupuesto
     WHERE p.idevento = ?`,
    { replacements: [eventIdNum] }
  );

  let presupuesto = null;
  let egresos = [];
  let ingresos = [];

  if (presupuestoData && presupuestoData.length > 0) {
    // Datos del presupuesto principal
    presupuesto = {
      idpresupuesto: presupuestoData[0].idpresupuesto,
      total_egresos: parseFloat(presupuestoData[0].total_egresos) || 0,
      total_ingresos: parseFloat(presupuestoData[0].total_ingresos) || 0,
      balance: parseFloat(presupuestoData[0].balance) || 0,
    };

    // Procesar egresos únicos
    const egresosMap = new Map();
    presupuestoData.forEach(row => {
      if (row.egreso_desc && !egresosMap.has(row.egreso_desc)) {
        egresosMap.set(row.egreso_desc, {
          idegreso: row.idegreso,
          descripcion: row.egreso_desc,
          cantidad: parseFloat(row.egreso_cant) || 0,
          precio_unitario: parseFloat(row.egreso_precio) || 0,
          total: parseFloat(row.egreso_total) || 0,
        });
      }
    });
    egresos = Array.from(egresosMap.values());

    // Procesar ingresos únicos
    const ingresosMap = new Map();
    presupuestoData.forEach(row => {
      if (row.ingreso_desc && !ingresosMap.has(row.ingreso_desc)) {
        ingresosMap.set(row.ingreso_desc, {
          idingreso: row.idingreso,
          descripcion: row.ingreso_desc,
          cantidad: parseFloat(row.ingreso_cant) || 0,
          precio_unitario: parseFloat(row.ingreso_precio) || 0,
          total: parseFloat(row.ingreso_total) || 0,
        });
      }
    });
    ingresos = Array.from(ingresosMap.values());
  }


    // ✅ Construir la respuesta completa con actividades y servicios
    const eventoCompleto = {
      ...evento.toJSON(),
      actividadesPrevias: actividades.filter(a => a.tipo === 'Previa'),
      actividadesDurante: actividades.filter(a => a.tipo === 'Durante'),
      actividadesPost: actividades.filter(a => a.tipo === 'Posterior'),
      serviciosContratados: servicios,
      Resultados: resultados || [],
      TiposDeEvento: tiposDeEvento,
      Objetivos: objetivos,
      Comite: comite,
      Recursos: recursos,
      Presupuesto: presupuesto,
      Egresos: egresos,
      Ingresos: ingresos,
      ObjetivosPDI: pdiIndependientes,
      Clasificacion: clasificacion,
      fase: evento.fase ? [{
        nrofase: evento.fase.nrofase
      }] : []
    };

    res.status(200).json(eventoCompleto);

  } catch (error) {
    console.error('Error detallado en getEventoById:', error);
    res.status(500).json({
      message: 'Error al obtener evento',
      error: error.message
    });
  }
});
const updateEvento = asyncHandler(async (req, res) => {
  const models = getModels(); 
  const sequelize = models.sequelize; 
  const { Evento } = models;
  
  const { id } = req.params;
  const idevento = parseInt(id, 10);

  if (isNaN(idevento) || idevento <= 0) {
    return res.status(400).json({ message: 'ID de evento inválido' });
  }

  const t = await sequelize.transaction();
  try {
    const [eventoExists] = await sequelize.query(
      'SELECT 1 FROM evento WHERE idevento = ?',
      { replacements: [idevento], transaction: t }
    );
    
    if (eventoExists.length === 0) {
      await t.rollback();
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    const camposActualizables = [
      'nombreevento', 'lugarevento', 'fechaevento', 'horaevento',
      'idlayout', 'descripcion', 'idacademico', 'idclasificacion', 'idsubcategoria'
    ];
    
    const camposParaActualizar = {};
    for (const campo of camposActualizables) {
      if (req.body[campo] !== undefined) {
        camposParaActualizar[campo] = req.body[campo];
      }
    }
    
    if (Object.keys(camposParaActualizar).length > 0) {
      const setClauses = Object.keys(camposParaActualizar).map(k => `"${k}" = ?`);
      const values = [...Object.values(camposParaActualizar), idevento];
      await sequelize.query(
        `UPDATE evento SET ${setClauses.join(', ')} WHERE idevento = ?`,
        { replacements: values, transaction: t }
      );
    }

    const TIPO_MAPEO = {
      actividadesPrevias: 'Previa',
      actividadesDurante: 'Durante',
      actividadesPost: 'Posterior'
    };

    for (const [tipoFrontend, tipoDB] of Object.entries(TIPO_MAPEO)) {
      if (Array.isArray(req.body[tipoFrontend])) {
        await sequelize.query(
          'DELETE FROM actividades WHERE idevento = ? AND tipo = ?',
          { replacements: [idevento, tipoDB], transaction: t }
        );
        for (const act of req.body[tipoFrontend]) {
          await sequelize.query(
            `INSERT INTO actividades (idevento, nombre, responsable, fecha_inicio, fecha_fin, tipo)
             VALUES (?, ?, ?, ?, ?, ?)`,
            {
              replacements: [
                idevento,
                act.nombreActividad?.trim() || '',
                act.responsable?.trim() || '',
                act.fechaInicio || null,
                act.fechaFin || null,
                tipoDB
              ],
              transaction: t
            }
          );
        }
      }
    }

    if (Array.isArray(req.body.serviciosContratados)) {
      await sequelize.query(
        'DELETE FROM servicio WHERE idevento = ?',
        { replacements: [idevento], transaction: t }
      );
      for (const s of req.body.serviciosContratados) {
        const fechaEntrega = s.fechaInicio instanceof Date
          ? s.fechaInicio.toISOString().split('T')[0]
          : (typeof s.fechaInicio === 'string' ? s.fechaInicio.split('T')[0] : null);
        await sequelize.query(
          `INSERT INTO servicio (idevento, nombreservicio, fechadeentrega, caracteristicas, observaciones)
           VALUES (?, ?, ?, ?, ?)`,
          {
            replacements: [
              idevento,
              s.nombreServicio?.trim() || '',
              fechaEntrega,
              s.caracteristica?.trim() || '',
              s.observaciones?.trim() || ''
            ],
            transaction: t
          }
        );
      }
    }

    if (req.body.nuevaFase) {
      const { nrofase } = req.body.nuevaFase;
      const [faseRow] = await sequelize.query(
        'SELECT idfase, nrofase FROM fase WHERE nrofase = ? LIMIT 1',
        { replacements: [parseInt(nrofase)], type: sequelize.QueryTypes.SELECT, transaction: t }
      );
      if (faseRow) {
        await sequelize.query(
          'UPDATE evento SET idfase = ? WHERE idevento = ?',
          { replacements: [faseRow.idfase, idevento], transaction: t }
        );
        console.log(`✅ Evento ${idevento} actualizado a fase ${nrofase}`);
      } else {
        console.warn(`⚠️ Fase con nrofase=${nrofase} no encontrada en catálogo`);
      }
    }

    await t.commit();

    // ✅ Fuera de la transacción, sin include problemático
    const eventoActualizado = await Evento.findByPk(idevento);

    return res.status(200).json({
      success: true,
      message: 'Evento actualizado correctamente',
      data: eventoActualizado
    });

  } catch (error) {
    if (!t.finished) {
      await t.rollback();
    }
    console.error('❌ Error en updateEvento:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Error al actualizar el evento',
      error: error.message,
    });
  }
});

const deleteEvento = asyncHandler(async (req, res) => {
  let models;
  try {
    models = getModels();
  } catch (e) {
    return res.status(500).json({ message: 'Servidor no listo' });
  }

  const { Evento } = models;
  const sequelize = models.sequelize;
  const { id } = req.params;
  const { razon_rechazo } = req.body;

  if (!id) return res.status(400).json({ message: 'ID de evento requerido' });

  const t = await sequelize.transaction();
  try {
    const evento = await Evento.findByPk(id, { transaction: t });
    if (!evento) {
      await t.rollback();
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    // ✅ Usa las columnas exactas que tiene tu tabla
    await sequelize.query(
      `UPDATE evento 
       SET estado = 'rechazado',
           fecha_rechazo = NOW(),
           razon_rechazo = ?,
           updated_at = NOW()
       WHERE idevento = ?`,
      { 
        replacements: [razon_rechazo || null, id], 
        transaction: t 
      }
    );

    await t.commit();
    console.log(`✅ Evento ${id} rechazado`);

    res.status(200).json({
      message: 'Evento rechazado correctamente',
      idevento: id,
      estado: 'rechazado'
    });

  } catch (error) {
    await t.rollback();
    console.error('❌ Error al rechazar evento:', error);
    res.status(500).json({ 
      message: 'Error al procesar el rechazo', 
      error: error.message 
    });
  }
});
const aprobarEvento = async (req, res) => {
  const { id } = req.params;
  try {
    const models = getModels();
    const { Evento } = models;


    const evento = await Evento.findByPk(id);
    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    await evento.update({ 
      estado: 'aprobado', fecha_aprobacion: new Date()});

    // Opcional: crear notificación para el creador
    // (puedes integrar notificationController aquí si lo deseas)

    return res.status(200).json({ message: 'Evento aprobado correctamente' });
  } catch (error) {
    console.error('Error al aprobar evento:', error);
    return res.status(500).json({ error: 'Error al aprobar el evento' });
  }
};

const rechazarEvento = async (req, res) => {
  const { id } = req.params;
  try {
   const models = getModels();
    const { Evento } = models;


    const evento = await Evento.findByPk(id);
    if (!evento) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }

    await evento.update({ estado: 'rechazado' });

    return res.status(200).json({ message: 'Evento rechazado correctamente' });
  } catch (error) {
    console.error('Error al rechazar evento:', error);
    return res.status(500).json({ error: 'Error al rechazar el evento' });
  }
};
/*const getEventos = asyncHandler(async (req, res) => {
  try {
    const eventos = await fetchEventsWithRawQuery();
    res.status(200).json(eventos);
  } catch (error) {
    console.error('Error al obtener eventos con consulta raw:', error);
    res.status(500).json({ 
      message: 'Error al obtener eventos',
      error: error.message 
    });
  }
});*/

const fetchEventById = async (id) => {
  const models = getModels();
  const Evento = models.Evento;
  try {
    console.log(`[DB] Buscando evento con ID: ${id}`);
    
    const evento = await Evento.findByPk(id, {
      attributes: {
        exclude: ['organizerId', 'categoryId', 'locationId']
      }
    });

    if (evento) {
      console.log(`[DB] Evento encontrado: ${evento.nombreevento}`);
    } else {
      console.log(`[DB] No se encontró ningún evento con ID: ${id}`);
    }
    
    return evento;
  } catch (error) {
    console.error('Error in fetchEventById:', error);
    throw error;
  }
};


const getEventosAprobados = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Evento, User, Fase } = models;
  try {
     const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);

    const userId = req.user.idusuario;
    const userRole = req.user.role;
    let eventos;

    if (userRole === 'admin' || userRole === 'daf') {
      eventos = await Evento.findAll({
        where: { 
          estado: 'aprobado'
         },
        attributes:{ include: ['idfase']},
        include: [
          {
            model: User,
            as: 'academicoCreador',
            attributes: ['nombre', 'apellidopat', 'apellidomat']
          }
        ],
        order: [['created_at', 'DESC']]
      });
      const activos = [];
      const vencidos = [];
      

    eventos.forEach(evento => {
      const fechaEvento = new Date(evento.fechaevento);
      fechaEvento.setHours(0, 0, 0, 0);
      
      const eventData = evento.get({ plain: true });
      const baseUrl = `${req.protocol}://${req.get('host')}/uploads/`;
      eventData.imagenUrl = eventData.imagen ? `${baseUrl}${eventData.imagen}` : null;
      eventData.esVencido = fechaEvento < hoy;

      if (fechaEvento >= hoy) {
        activos.push(eventData);
      } else {
        vencidos.push(eventData);
      }
    });

    res.status(200).json({
      activos,
      vencidos,
      total: eventos.length,
      fechaConsulta: new Date()
    });

    } else if (userRole === 'academico') {
      // Paso 1: Eventos donde soy miembro del comité
      const eventosEnComite = await sequelize.query(
        'SELECT idevento FROM evento_comite WHERE idusuario = ?',
        { replacements: [userId], type: sequelize.QueryTypes.SELECT }
      );
      const idsEventosComite = eventosEnComite.map(r => r.idevento);

      // Paso 2: Facultad del usuario actual
      const academicoActual = await models.Academico.findOne({
        where: { idusuario: userId },
        attributes: ['facultad_id']
      });

      let idsCreadores = [];

      if (academicoActual?.facultad_id) {
        // Paso 3: Todos los creadores de la misma facultad
        const creadoresMismaFacultad = await models.Academico.findAll({
          where: { facultad_id: academicoActual.facultad_id },
          attributes: ['idusuario']
        });
        idsCreadores = creadoresMismaFacultad.map(a => a.idusuario);
      }

      // Paso 4: Combinar condiciones
      const condiciones = [];
      if (idsCreadores.length > 0) {
        condiciones.push({ idacademico: { [Op.in]: idsCreadores } });
      }
      if (idsEventosComite.length > 0) {
        condiciones.push({ idevento: { [Op.in]: idsEventosComite } });
      }

      if (condiciones.length === 0) {
        return res.status(200).json([]);
      }

      eventos = await Evento.findAll({
        where: {
          estado: 'aprobado',
          [Op.or]: condiciones
        },
        include: [
          {
            model: User,
            as: 'academicoCreador',
            attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat']
          }
        
        ],
        order: [['created_at', 'DESC']]
      });
    } else {
      return res.status(403).json({ message: 'Acceso denegado' });
    }
      const eventoIds = eventos.map(e => e.idevento);
    const fases = await models.Fase.findAll({
      where: { idfase: { [Op.in]: eventos.map(e => e.idfase).filter(id => id) } },
      attributes: ['idfase', 'nrofase']
    });

    const faseMap = new Map(fases.map(f => [f.idfase, f.nrofase]));

    const eventosFormateados = eventos.map(event => {
      const creador = event.academicoCreador;
      const eventoPlain = event.get({ plain: true });
      return {
        id: event.idevento,
        title: event.nombreevento || 'Sin título',
        description: event.descripcion || 'Sin descripción',
        date: event.fechaevento ? new Date(event.fechaevento).toLocaleDateString('es-ES') : 'N/A',
        time: event.horaevento || 'N/A',
        location: event.lugarevento || 'Sin ubicación',
        organizer: creador 
          ? `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim() || 'Sin nombre'
          : 'Sin organizador',
        category: 'General',
        priority: 'normal',
        submittedBy: creador 
          ? `${creador.nombre?.charAt(0) || ''}. ${creador.apellidopat || ''}`.trim()
          : 'Sistema',
        submittedDate: event.created_at || event.fechaevento,
        status: event.estado,
        approvedAt: event.fecha_aprobacion 
          ? new Date(event.fecha_aprobacion).toLocaleString('es-ES') 
          : null,
        approvedBy: event.admin_aprobador || null,
        rejectionDate: event.fecha_rechazo 
          ? new Date(event.fecha_rechazo).toLocaleDateString('es-ES') 
          : null,
        rejectionReason: event.razon_rechazo || null,
        additionalComments: event.comentarios_admin || null,
        classificationId: event.idclasificacion || null,
        resultId: event.idresultado || null,
        updatedAt: event.updatedAt 
          ? new Date(event.updatedAt).toLocaleString('es-ES') 
          : null,
         //fase: eventoPlain.fase ? [eventoPlain.fase] : [],
         idfase: event.idfase || null,
        
      };
    });

    return res.status(200).json(eventosFormateados);
  } catch (error) {
    console.error('Error en getEventosAprobados:', error);
    return res.status(500).json({ error: 'Error al cargar eventos aprobados' });
  }
});
const getEventosAprobadosPorFacultad = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Evento, User, Academico, Facultad, Estudiante, Carrera } = models;
  
  try {
    const userId = req.user.idusuario;
    const userRole = req.user.role;
    let facultadId = req.query.facultad_id;

    console.log(`🔍 [${userRole}] Iniciando búsqueda. facultad_id query:`, facultadId);

    if (!facultadId) {
      if (userRole === 'academico') {
        const acad = await Academico.findOne({
          where: { idusuario: userId },
          attributes: ['facultad_id']
        });
        facultadId = acad?.facultad_id;
      } else if (userRole === 'student') {
        const est = await Estudiante.findOne({
          where: { idusuario: userId },
          attributes: ['idcarrera']
        });
        if (est?.idcarrera) {
          const carrera = await Carrera.findByPk(est.idcarrera, {
            attributes: ['idfacultad']
          });
          facultadId = carrera?.idfacultad;
        }
      }
    }

    let eventos = [];

    if (userRole === 'admin' || userRole === 'daf') {
      console.log('👑 Admin/DAF: Obteniendo TODOS los eventos aprobados');
      eventos = await Evento.findAll({
        where: { estado: 'aprobado' },
        distinct: true,
        attributes: { include: ['idfase'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          attributes: ['nombre', 'apellidopat', 'apellidomat'],
          include: [{
            model: Academico,
            as: 'academico',
            attributes: ['facultad_id'],
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }],
        order: [['created_at', 'DESC']]
      });

    } else if (userRole === 'academico') {
      if (!facultadId) {
        return res.status(400).json({ message: 'Académico sin facultad asignada' });
      }
      console.log('👨‍ Académico: Filtrando por facultad_id:', facultadId);
      eventos = await Evento.findAll({
        where: { estado: 'aprobado' },
        distinct: true,
        include: [{
          model: User,
          as: 'academicoCreador',
          required: true,
          attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat'],
          include: [{
            model: Academico,
            as: 'academico',
            where: { facultad_id: facultadId }, 
            required: true, 
            attributes: ['facultad_id'],
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }],
        order: [['created_at', 'DESC']]
      });

    } else if (userRole === 'student') {
      if (!facultadId) {
        console.warn('⚠️ Estudiante sin facultad_id');
        return res.status(200).json([]); 
      }
      console.log('🎓 Estudiante: Filtrando por facultad_id:', facultadId);
      eventos = await Evento.findAll({
        where: { estado: 'aprobado' },
        distinct: true,
        attributes: { include: ['idfase'] },
        include: [{
          model: User,
          as: 'academicoCreador',
          required: true,
          attributes: ['nombre', 'apellidopat', 'apellidomat'],
          include: [{
            model: Academico,
            as: 'academico',
            where: { facultad_id: facultadId }, 
            required: true,
            attributes: ['facultad_id'],
            include: [{
              model: Facultad,
              as: 'facultad',
              attributes: ['nombre_facultad']
            }]
          }]
        }],
        order: [['created_at', 'DESC']]
      });
    } else {
      return res.status(403).json({ message: 'Acceso denegado' });
    }

    const eventosUnicos = Array.from(
      new Map(eventos.map(e => [e.idevento, e])).values()
    );

    console.log(`✅ Eventos encontrados para ${userRole}:`, eventosUnicos.length);

    const eventosFormateados = eventosUnicos.map(event => {
      const creador = event.academicoCreador;
      const facultadNombre = creador?.academico?.facultad?.nombre_facultad || 'Sin facultad';
      return {
        id: event.idevento,
        title: event.nombreevento || 'Sin título',
        description: event.descripcion || 'Sin descripción',
        date: event.fechaevento ? new Date(event.fechaevento).toLocaleDateString('es-ES') : 'N/A',
        time: event.horaevento || 'N/A',
        location: event.lugarevento || 'Sin ubicación',
        organizer: creador
          ? `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim() || 'Sin nombre'
          : 'Sin organizador',
        category: 'General',
        submittedBy: creador
          ? `${creador.nombre?.charAt(0) || ''}. ${creador.apellidopat || ''}`.trim()
          : 'Sistema',
        submittedDate: event.created_at || event.fechaevento,
        approvedAt: event.fecha_aprobacion
          ? new Date(event.fecha_aprobacion).toLocaleString('es-ES')
          : null,
        approvedBy: event.admin_aprobador || null,
        additionalComments: event.comentarios_admin || null,
        idfase: event.idfase || 1,
        faculty: facultadNombre,
        facultad_id: facultadId
      };
    });

    return res.status(200).json(eventosFormateados);

  } catch (error) {
    console.error('❌ Error en getEventosAprobadosPorFacultad:', error);
    return res.status(500).json({ 
      error: 'Error al cargar eventos aprobados con facultad',
      details: error.message 
    });
  }
});

const getEventosNoAprobados = async (req, res) => {
    const models = getModels();
    const { Evento, User, Academico, Facultad } = models;
    const { Op } = require('sequelize'); // Asegúrate de tener Op disponible (ya está importado al inicio del archivo)

    try {
        const userId = req.user.idusuario;
        const userRole = req.user.role;
        
        // --- NUEVO: Calcular fecha límite (hace 1 mes) ---
        const fechaLimite = new Date();
        fechaLimite.setMonth(fechaLimite.getMonth() - 1);
        // -------------------------------------------------

        let eventos;
        if (userRole === 'admin' || userRole === 'daf') {
            // ✅ Admin/DAF ven TODOS los eventos pendientes RECIENTES
            eventos = await Evento.findAll({
                where: { 
                    estado: 'pendiente',
                    // --- NUEVO: Filtrar por fecha de creación ---
                    created_at: { [Op.gte]: fechaLimite } 
                    // Si prefieres filtrar por la fecha del evento usa: fechaevento: { [Op.gte]: fechaLimite }
                },
                distinct: true,
                attributes: { include: ['idfase'] },
                include: [{
                    model: User,
                    as: 'academicoCreador',
                    attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat'],
                    include: [{
                        model: Academico,
                        as: 'academico',
                        attributes: ['facultad_id'],
                        include: [{
                            model: Facultad,
                            as: 'facultad',
                            attributes: ['nombre_facultad']
                        }]
                    }]
                }],
                order: [['created_at', 'DESC']]
            });
        } else if (userRole === 'academico') {
            const academicoLogueado = await Academico.findOne({
                where: { idusuario: userId },
                attributes: ['facultad_id']
            });
            if (!academicoLogueado) {
                return res.status(404).json({ message: 'Académico no encontrado' });
            }
            const facultadId = academicoLogueado.facultad_id;
            eventos = await Evento.findAll({
                where: { 
                    estado: 'pendiente',
                    // --- NUEVO: Filtrar por fecha de creación ---
                    created_at: { [Op.gte]: fechaLimite }
                },
                subQuery: false,
                include: [{
                    model: User,
                    as: 'academicoCreador',
                    attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat'],
                    required: true,
                    include: [{
                        model: Academico,
                        as: 'academico',
                        attributes: ['facultad_id'],
                        where: { facultad_id: facultadId },
                        required: true,
                        include: [{
                            model: Facultad,
                            as: 'facultad',
                            attributes: ['nombre_facultad']
                        }]
                    }]
                }],
                order: [['created_at', 'DESC']]
            });
        } else {
            return res.status(403).json({ message: 'Acceso denegado' });
        }

        // ... (El resto del código de formateado se mantiene igual) ...
        const eventosUnicos = Array.from(
            new Map(eventos.map(e => [e.idevento, e])).values()
        );
        const eventosFormateados = eventosUnicos.map(event => {
            const creador = event.academicoCreador;
            const facultadNombre = creador?.academico?.facultad?.nombre_facultad || 'Sin facultad';
            return {
                id: event.idevento,
                title: event.nombreevento || 'Sin título',
                description: event.descripcion || 'Sin descripción',
                date: event.fechaevento ? new Date(event.fechaevento).toLocaleDateString('es-ES') : 'N/A',
                time: event.horaevento || 'N/A',
                location: event.lugarevento || 'Sin ubicación',
                organizer: creador
                    ? `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim() || 'Sin nombre'
                    : 'Sin organizador',
                category: 'General',
                priority: 'normal',
                submittedBy: creador
                    ? `${creador.nombre?.charAt(0) || ''}. ${creador.apellidopat || ''}`.trim()
                    : 'Sistema',
                submittedDate: event.created_at || event.fechaevento,
                approvedAt: event.fecha_aprobacion,
                approvedBy: event.admin_aprobador,
                additionalComments: event.comentarios_admin,
                rejectionDate: event.fecha_rechazo,
                rejectionReason: event.razon_rechazo,
                classificationId: event.idclasificacion,
                resultId: event.idresultado,
                area: facultadNombre 
            };
        });
        return res.status(200).json(eventosFormateados);
    } catch (error) {
        console.error('Error en getEventosNoAprobados:', error);
        return res.status(500).json({ error: 'Error al cargar eventos pendientes' });
    }
};
  

  
const getDashboardStats = asyncHandler(async (req, res) => {
  const models = getModels();
  const sequelize = models.sequelize;
  const { Evento, User } = models;

  const ahora = new Date();
  const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);

  const [activeUsers, totalEvents, estadoCounts] = await Promise.all([
    User.count({ where: { habilitado: '1' } }),
    Evento.count(),
    Evento.findAll({
      attributes: ['estado', [sequelize.fn('COUNT', sequelize.col('estado')), 'total']],
      group: ['estado'],
      raw: true
    })
  ]);

  // 2. Raw query separada para usuarios nuevos
  const resultadoRaw = await sequelize.query(
    `SELECT COUNT(*) as total FROM usuario WHERE created_at >= :inicioMes`,
    { replacements: { inicioMes }, type: sequelize.QueryTypes.SELECT }
  );
  console.log('🔍 resultadoRaw completo:', JSON.stringify(resultadoRaw));
console.log('🔍 inicioMes:', inicioMes);

  const resultNuevos = resultadoRaw[0];
 console.log('🔍 resultNuevos:', resultNuevos);
const usuariosNuevosEsteMes = parseInt(resultNuevos?.total || resultNuevos?.count || 0);
console.log('🔍 usuariosNuevosEsteMes:', usuariosNuevosEsteMes);
  const estadoMap = {};
  estadoCounts.forEach(e => { estadoMap[e.estado] = parseInt(e.total); });

  const aprobados = estadoMap['aprobado'] || 0;
  const tasaAprobacion = totalEvents > 0 ? Math.round((aprobados / totalEvents) * 100) : 0;

  res.status(200).json({
    activeUsers,
    totalEvents,
    usuariosNuevosEsteMes,
    estadoCounts: estadoMap,
    tasaAprobacion,
    systemStability: 98,
    tiempoPromedioAprobacion: 0,
  });
});
const getHistoricalData = asyncHandler(async (req, res) => {
  // Verificar que sea admin
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Acceso denegado: solo administradores' });
  }

  const models = getModels();
  const { Evento } = models;

  try {
    const now = new Date();
    const historical = [];

    // Últimos 6 meses (de más antiguo a más reciente)
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthName = monthDate.toLocaleString('es-ES', { month: 'short' });

      const count = await Evento.count({
        where: {
          created_at: {
            [Op.gte]: new Date(monthDate.getFullYear(), monthDate.getMonth(), 1),
            [Op.lt]: new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1)
          }
        }
      });

      historical.push({
        name: monthName,
        eventos: count
      });
    }

    res.status(200).json({ historical });
  } catch (error) {
    console.error('Error en getHistoricalData:', error);
    res.status(500).json({ message: 'Error al cargar datos históricos' });
  }
});
const getEventoCompletoById = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Evento, User, Recurso, ClasificacionEstrategica, Subcategoria } = models;

  try {
    const { id } = req.params;
    const eventIdNum = parseInt(id, 10);

    if (isNaN(eventIdNum)) {
      return res.status(400).json({ message: 'ID de evento inválido' });
    }

    // 1. Obtener el evento principal con su creador
    const evento = await Evento.findByPk(eventIdNum, {
      include: [{
        model: User,
        as: 'academicoCreador',
        attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email', 'role']
      }]
    });

    if (!evento) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    // 2. Obtener los recursos del evento
    const [recursos] = await sequelize.query(
      `SELECT r."idrecurso", r."nombre_recurso", r."recurso_tipo", 
              r."descripcion", r."habilitado", r."cantidad"
       FROM "evento_recurso" er
       JOIN "recurso" r ON er."idrecurso" = r."idrecurso"
       WHERE er."idevento" = ?`,
      { replacements: [eventIdNum] }
    );

    // 3. Obtener la clasificación estratégica con su subcategoría
    const [clasificacionData] = await sequelize.query(
      `SELECT 
         c."idclasificacion", 
         c."nombre_clasificacion" AS "nombreClasificacion",
         s."idsubcategoria",
         s."nombre_subcategoria" AS "nombresubcategoria"
       FROM "evento" e
       LEFT JOIN "clasificacion_estrategica" c ON e."idclasificacion" = c."idclasificacion"
       LEFT JOIN "subcategoria" s ON e."idsubcategoria" = s."idsubcategoria"
       WHERE e."idevento" = ?`,
      { replacements: [eventIdNum] }
    );

    const clasificacion = clasificacionData[0] || null;

    // 4. Construir la respuesta completa
    const eventoCompleto = {
      ...evento.toJSON(),
      Recursos: recursos,
      Clasificacion: clasificacion
    };

    res.status(200).json(eventoCompleto);

  } catch (error) {
    console.error('Error al obtener evento completo:', error);
    res.status(500).json({
      message: 'Error al obtener evento',
      error: error.message
    });
  }
});
const getEstudianteFacultad = asyncHandler(async (req, res) => {
  try {
    const { facultad_id } = req.params;
     const facultadId = parseInt(facultad_id);

      if (isNaN(facultadId)) {
      return res.status(400).json({ message: 'ID de facultad inválido' });
    }
    console.log('🔍 getEstudianteFacultad - Parámetro recibido:', facultad_id);
    


    const models =  getModels();
    const { Evento, User, Academico } = models;
    
    console.log('📡 Buscando eventos aprobados para facultad_id:', facultadId);
    
    // Buscar eventos por la facultad del académico creador
    const eventos = await Evento.findAll({
      where: {
        estado: 'aprobado'
      },
      include: [{
        model: User,
        as: 'academicoCreador',
        attributes: ['nombre', 'apellidopat', 'apellidomat'],
        required: true,
        include: [{
          model: Academico,
          as: 'academico',
          where: { facultad_id: facultadId },
          required: true,
          attributes: ['facultad_id']
        }]
      }],
      order: [['fechaevento', 'ASC']]
    });

    console.log(`📊 Eventos encontrados: ${eventos.length}`);

    const eventosFormateados = eventos.map(evento => {
      const creador = evento.academicoCreador;
      return {
        idevento: evento.idevento,
        nombre: evento.nombreevento,
        fecha_inicio: evento.fechaevento || evento.fecha_inicio,
        fecha_fin: evento.fecha_fin,
        ubicacion: evento.lugarevento,
        tipo_evento: evento.tipo_evento || 'Evento',
        estado: evento.estado,
        organizador: creador
          ? `${creador.nombre || ''} ${creador.apellidopat || ''}`.trim()
          : 'Sin organizador',
        descripcion: evento.descripcion
      };
    });

    console.log(`✅ ${eventosFormateados.length} eventos formateados`);
    res.status(200).json(eventosFormateados);
    
  } catch (error) {
    console.error('❌ Error en getEstudianteFacultad:', error);
    console.error('❌ Stack:', error.stack);
    
    res.status(500).json({ 
      message: 'Error al obtener eventos de la facultad', 
      error: error.message
    });
  }
});
const getCarreraById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔍 getCarreraById - Buscando carrera con ID:', id);
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'ID de carrera inválido' });
    }

    const models = getModels();
    const { Carrera } = models;

    // Tu tabla se llama 'carrera' y la PK es 'idcarrera'
    const carrera = await Carrera.findByPk(parseInt(id));

    if (!carrera) {
      console.log(`❌ Carrera con idcarrera=${id} no encontrada`);
      return res.status(404).json({ message: 'Carrera no encontrada' });
    }

    console.log('✅ Carrera encontrada:', carrera.nombre_carrera);

    res.status(200).json({
      idcarrera: carrera.idcarrera,
      nombre: carrera.nombre_carrera,
      descripcion: carrera.descripcion || '',
      idfacultad: carrera.idfacultad
    });

  } catch (error) {
    console.error('❌ Error obteniendo carrera:', error);
    res.status(500).json({ 
      message: 'Error al obtener carrera', 
      error: error.message 
    });
  }
});

const getFacultadById = asyncHandler(async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log('🔍 getFacultadById - Buscando facultad con ID:', id);
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ message: 'ID de facultad inválido' });
    }

    const models = getModels();
    const { Facultad } = models;

    // ⚠️ IMPORTANTE: Tu tabla 'facultad' tiene PK = 'facultad_id'
    // Pero tu estudiante tiene 'idfacultad' que NO es la PK
    // Necesitamos buscar por 'facultad_id' cuando el frontend pasa ese valor
    
    const facultadId = parseInt(id);
    
    // Buscar por la PK correcta
    const facultad = await Facultad.findOne({
      where: { facultad_id: facultadId }
    });

    if (!facultad) {
      console.log(`❌ Facultad con facultad_id=${id} no encontrada`);
      
      // Información de depuración
      const todasFacultades = await Facultad.findAll({ 
        attributes: ['facultad_id', 'nombre_facultad'] 
      });
      console.log('📋 Facultades disponibles:', todasFacultades);
      
      return res.status(404).json({ message: 'Facultad no encontrada' });
    }

    console.log('✅ Facultad encontrada:', facultad.nombre_facultad);

    res.status(200).json({
      idfacultad: facultad.facultad_id,  // ← Frontend espera 'idfacultad'
      nombre: facultad.nombre_facultad,
      descripcion: facultad.descripcion || ''
    });

  } catch (error) {
    console.error('❌ Error obteniendo facultad:', error);
    console.error('❌ Stack completo:', error.stack);
    
    res.status(500).json({ 
      message: 'Error al obtener facultad', 
      error: error.message 
    });
  }
});
const diagnosticarModelos = asyncHandler(async (req, res) => {
  try {
    const models = getModels();
    
    console.log('\n========== DIAGNÓSTICO DE MODELOS ==========');
    console.log('📋 Modelos disponibles:', Object.keys(models));
    console.log('============================================\n');
    
    // Intentar obtener carrera
    let carreraInfo = 'NO DISPONIBLE';
    try {
      if (models.Carrera) {
        const carrera = await models.Carrera.findByPk(1);
        carreraInfo = carrera ? carrera.toJSON() : 'No existe carrera con ID 1';
      }
    } catch (e) {
      carreraInfo = `Error: ${e.message}`;
    }
    
    // Intentar obtener facultad
    let facultadInfo = 'NO DISPONIBLE';
    try {
      if (models.Facultad) {
        const facultad = await models.Facultad.findOne({ where: { facultad_id: 1 } });
        facultadInfo = facultad ? facultad.toJSON() : 'No existe facultad con facultad_id 1';
      }
    } catch (e) {
      facultadInfo = `Error: ${e.message}`;
    }
    
    // Intentar con nombre alternativo
    let facultadAlt = 'NO PROBADO';
    try {
      if (models.Facultades) {
        const facultad = await models.Facultades.findOne({ where: { facultad_id: 1 } });
        facultadAlt = facultad ? facultad.toJSON() : 'No existe';
      }
    } catch (e) {
      facultadAlt = `Error: ${e.message}`;
    }
    
    res.json({
      modelosDisponibles: Object.keys(models),
      carrera: carreraInfo,
      facultad: facultadInfo,
      facultadAlternativo: facultadAlt
    });
    
  } catch (error) {
    console.error('❌ Error en diagnóstico:', error);
    res.status(500).json({ 
      error: error.message,
      stack: error.stack
    });
  }
});

module.exports ={
    createEvento,
    getAllEventos,
    fetchAllEvents,
    getEventoById,
    updateEvento,
    deleteEvento,
    aprobarEvento,
    rechazarEvento,
    fetchEventById,
    getEventosAprobados,
    getEventosAprobadosPorFacultad,
    getEventosNoAprobados,
    getEventosRechazados,
    getDashboardStats,
    getHistoricalData,
    getEventoCompletoById,
    getEstudianteFacultad,
    getCarreraById,
    getFacultadById,
    diagnosticarModelos
}













