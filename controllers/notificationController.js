const asyncHandler = require('express-async-handler');
const { getModels } = require('../models/index.js'); 

const sendNotification = async ({ idusuario, titulo, mensaje, tipo = 'nuevo_evento', estado = 'no_leido', id_relacionado = null }) => {
  try {
    // ✅ Si llega un array, enviar una notificación por cada usuario
    if (Array.isArray(idusuario)) {
      for (const id of idusuario) {
        await sendNotification({ idusuario: id, titulo, mensaje, tipo, estado });
      }
      return;
    }

    if (!idusuario) {
      console.warn('⚠️ sendNotification: idusuario no proporcionado');
      return;
    }
    
    const models = getModels();
    const sequelize = models.sequelize;
    
    await sequelize.query(
      `INSERT INTO notificacion (idusuario, titulo, mensaje, tipo, estado, created_at, updated_at) 
       VALUES (:idusuario, :titulo, :mensaje, :tipo, :estado, :created_at, :updated_at)`,
      {
        replacements: {
          idusuario,
          titulo,
          mensaje,
          tipo,
          estado,
          created_at: new Date(),
          updated_at: new Date(),
          id
        },
        type: sequelize.QueryTypes.INSERT
      }
    );

    console.log(`✅ Notificación enviada a usuario ${idusuario}`);

  } catch (error) {
    console.error('❗ Error al crear notificación:', error.message);
  }
};


const getUserNotifications = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Notificacion } = models;

  const userId = req.user?.idusuario;
  if (!userId) {
    return res.status(401).json({ error: 'Usuario no autenticado' });
  }

  const notificaciones = await Notificacion.findAll({
    where: { idusuario: userId },
    order: [['created_at', 'DESC']],
    attributes: ['idnotificacion', 'titulo', 'mensaje', 'tipo', 'estado', 'created_at'],
  });

  res.json(notificaciones);
});

const read = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Notificacion } = models;

  const { id } = req.params;
  const userId = req.user?.idusuario;
  
  if (!userId) return res.status(401).json({ message: 'Usuario no autenticado' });

  const [updated] = await Notificacion.update(
    { estado: 'leido', updated_at: new Date() },
    { where: { idnotificacion: id, idusuario: userId } }
  );

  if (updated === 0) return res.status(404).json({ message: 'Notificación no encontrada' });

  res.json({ success: true, message: 'Notificación marcada como leída' });
});

const markAsRead = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Notificacion } = models;

  const notificationId = req.params.id;
  const userId = req.user?.idusuario;

  if (!userId) {
    return res.status(401).json({ message: 'Usuario no autenticado' });
  }

  const [updated] = await Notificacion.update(
    { estado: 'leido', updated_at: new Date() }, // ✅ Solo 'estado', sin campo 'read' inexistente
    {
      where: {
        idnotificacion: notificationId,
        idusuario: userId
      }
    }
  );

  if (updated === 0) {
    return res.status(404).json({ error: 'Notificación no encontrada' });
  }

  res.json({ success: true, message: 'Notificación marcada como leída' });
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const models = getModels();
  const { Notificacion } = models;

  const userId = req.user?.idusuario;

  if (!userId) {
    return res.status(401).json({ message: 'Usuario no autenticado' });
  }

  const count = await Notificacion.count({
    where: {
      idusuario: userId,
      estado: 'pendiente' 
    }
  });

  res.json({ unread_count: count });
});

module.exports = {
  sendNotification,        
  getUserNotifications,
  markAsRead,
  getUnreadCount,
  read
};