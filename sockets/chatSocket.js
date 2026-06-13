// sockets/chatSocket.js
module.exports = (io) => {
  const eventUsers = new Map();

  io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);

    socket.on('join_private', async ({ roomId, userId, userName }) => {
      console.log('🔐 [PRIVADO] Usuario se une:', { roomId, userId });
      socket.join(roomId);
      socket.data = { ...socket.data, roomId, isPrivate: true, userId, userName };

      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();

        const ids = roomId.replace('private_', '').split('_');
        
        const historial = await ChatMensaje.findAll({
          where: {
            idevento: 0,
          },
          order: [['createdAt', 'ASC']],
          limit: 50
        });

        const mensajesFiltrados = historial.filter(m => 
          ids.includes(String(m.idusuario))
        );

        socket.emit('history', mensajesFiltrados.map(m => ({
          userId: m.idusuario,
          userName: m.user_name,
          role: m.role,
          message: m.message,
          timestamp: m.createdAt
        })));

        console.log('✅ [PRIVADO] Historial enviado:', mensajesFiltrados.length, 'mensajes');
      } catch (e) {
        console.warn('⚠️ [PRIVADO] Error cargando historial:', e.message);
        socket.emit('history', []);
      }
    });

    socket.on('send_private', async ({ roomId, userId, userName, role, message }) => {
  console.log('💬 [PRIVADO] Mensaje:', { roomId, userId, message: message.substring(0, 50) });

  try {
    const { getModels } = require('../models');
    const models = getModels();
    const ChatMensaje = models.ChatMensaje;
     
    if (!ChatMensaje) {
      console.error('❌ ChatMensaje no disponible');
      socket.emit('error', { message: 'Modelo no disponible' });
      return;
    }  

    console.log('[PRIVADO] 🔍 Modelos disponibles:', Object.keys(models));
    console.log('[PRIVADO] 🔍 ChatMensaje existe:', !!models.ChatMensaje);
    console.log('[PRIVADO] 🔍 ChatMensaje type:', typeof models.ChatMensaje);
    console.log('[PRIVADO] ChatMensaje disponible:', typeof ChatMensaje.create);

    const nuevoMensaje = await ChatMensaje.create({
      idevento: 0,
      idusuario: parseInt(userId),
      user_name: userName,
      role,
      message
    });
    console.log('✅ Mensaje guardado ID:', nuevoMensaje.id);

    io.to(roomId).emit('private_message', {
      userId: parseInt(userId),
      userName: userName || 'Usuario',
      role,
      message,
      timestamp: new Date().toISOString()
    });

    console.log('✅ [PRIVADO] Mensaje enviado a sala:', roomId);
  } catch (e) {
    console.error('❌ [PRIVADO] Error completo:', e);
    console.error('❌ [PRIVADO] Mensaje:', e.message);
    socket.emit('error', { message: 'Error al enviar mensaje privado: ' + e.message });
  }
});

    socket.on('leave_private', ({ roomId }) => {
      console.log('🚪 [PRIVADO] Usuario sale:', roomId);
      socket.leave(roomId);
    });

    socket.on('join_event', async ({ eventoId, userId, role, userName }) => {
      const room = `evento_${eventoId}`;
      console.log('👥 [EVENTO] Usuario se une:', { eventoId, userId, userName, room });

      try {
        const { getModels } = require('../models');
        const { ChatMensaje, Comite, Evento } = getModels();

        if (eventoId !== 'general') {
          const [esMiembroComite, evento] = await Promise.all([
            Comite.findOne({
              where: {
                idevento: parseInt(eventoId),
                idusuario: parseInt(userId)
              }
            }),
            Evento.findOne({
              where: { idevento: parseInt(eventoId) }
            })
          ]);

          const esCreador = evento && parseInt(evento.idacademico) === parseInt(userId);

          if (!esMiembroComite && !esCreador) {
            console.warn('⚠️ [EVENTO] Usuario sin acceso:', { userId, eventoId });
            socket.emit('error', { message: 'No tienes acceso a este chat' });
            return;
          }
        }

        socket.join(room);
        socket.data = { userId, role, eventoId, userName };

        if (!eventUsers.has(eventoId)) {
          eventUsers.set(eventoId, new Map());
        }
        eventUsers.get(eventoId).set(String(userId), {
          userId: String(userId),
          userName,
          role,
          socketId: socket.id
        });

        const userList = Array.from(eventUsers.get(eventoId).values());
        io.to(room).emit('user_list', userList);

        const historial = await ChatMensaje.findAll({
          where: { idevento: parseInt(eventoId) },
          order: [['createdAt', 'ASC']],
          limit: 50
        });

        socket.emit('history', historial.map(m => ({
          userId: m.idusuario,
          userName: m.user_name,
          role: m.role,
          message: m.message,
          timestamp: m.createdAt
        })));

        socket.to(room).emit('user_joined', { userId, userName, role });
        console.log(`✅ [EVENTO] ${userName} (${role}) → sala ${room}`);

      } catch (e) {
        console.warn('⚠️ [EVENTO] Error en join_event:', e.message);
        console.error('⚠️ [EVENTO] Stack:', e.stack);
        socket.emit('history', []);
      }
    });

    socket.on('send_message', async ({ eventoId, userId, role, userName, message }) => {
  const room = `evento_${eventoId}`;
  console.log('💬 [EVENTO] Mensaje:', { eventoId, userId, userName, message });

  try {
    const { getModels } = require('../models');
    const { ChatMensaje } = getModels();

    await ChatMensaje.create({
      idevento: parseInt(eventoId),
      idusuario: parseInt(userId),
      user_name: userName || null,
      role,
      message
    });

    // 🔥 EMITIR a todos en la sala
    io.to(room).emit('receive_message', {
      userId: parseInt(userId),
      userName: userName || 'Usuario',
      role,
      message,
      timestamp: new Date().toISOString()
    });

    console.log('✅ [EVENTO] Mensaje emitido a:', room);
  } catch (e) {
    console.error('❌ [EVENTO] Error:', e.message);
    socket.emit('error', { message: e.message });
  }
});

    socket.on('leave_event', ({ eventoId }) => {
      console.log('🚪 [EVENTO] Usuario sale:', eventoId);
      socket.leave(`evento_${eventoId}`);
    });

    socket.on('disconnect', () => {
      console.log('❌ Usuario desconectado:', socket.id);

      const { userId, eventoId, userName, role } = socket.data || {};

      if (eventoId && userId && eventUsers.has(eventoId)) {
        const userMap = eventUsers.get(eventoId);
        const user = userMap.get(String(userId));
        userMap.delete(String(userId));

        const room = `evento_${eventoId}`;

        if (userMap.size === 0) {
          eventUsers.delete(eventoId);
        } else {
          const userList = Array.from(userMap.values());
          io.to(room).emit('user_list', userList);
        }

        socket.to(room).emit('user_left', {
          userId,
          userName: user?.userName || userName,
          role: user?.role || role
        });

        console.log(`👋 ${userName || 'Usuario'} salió de ${room}`);
      }
    });
  });

  console.log('✅ [SOCKET] Chat socket inicializado correctamente');
};