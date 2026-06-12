// sockets/chatSocket.js
module.exports = (io) => {
  const eventUsers = new Map();

  io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);

    socket.on('join_private', async ({ roomId, userId, userName }) => {
      console.log('🔐 [PRIVATE] Usuario se une a sala privada:', { roomId, userId });
      socket.join(roomId);
      socket.data = { ...socket.data, roomId, isPrivate: true };

      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();

        // Enviar historial de chat privado
        const historial = await ChatMensaje.findAll({
          where: { evento_id: roomId }, // roomId = 'private_24_57'
          order: [['createdAt', 'ASC']],
          limit: 50
        });

        socket.emit('history', historial.map(m => ({
          userId:    m.user_id,
          userName:  m.user_name,
          role:      m.role,
          message:   m.message,
          timestamp: m.createdAt
        })));
      } catch (e) {
        console.warn('⚠️ [PRIVATE] Error cargando historial:', e.message);
        socket.emit('history', []);
      }
    });

    socket.on('send_private', async ({ roomId, userId, userName, role, message }) => {
      console.log('💬 [PRIVATE] Mensaje privado:', { roomId, userId, message });

      try {
        const { getModels } = require('../models');
        const { ChatMensaje } = getModels();

        await ChatMensaje.create({
          evento_id: roomId,
          user_id: String(userId),
          user_name: userName,
          role,
          message
        });

        io.to(roomId).emit('private_message', {
          userId,
          userName,
          role,
          message,
          timestamp: new Date().toISOString()
        });

        console.log('✅ [PRIVATE] Mensaje emitido a sala:', roomId);
      } catch (e) {
        console.error('❌ [PRIVATE] Error:', e.message);
        socket.emit('error', { message: 'Error al enviar mensaje privado' });
      }
    });

    socket.on('leave_private', ({ roomId }) => {
      console.log('🚪 [PRIVATE] Usuario sale de sala:', roomId);
      socket.leave(roomId);
    });

    socket.on('join_event', async ({ eventoId, userId, role, userName }) => {
      const room = `evento_${eventoId}`;
      console.log('👥 [EVENT] Usuario se une:', { eventoId, userId, userName, room });

      try {
        const { getModels } = require('../models');
        const { ChatMensaje, Comite, Evento } = getModels();

        // Validar acceso
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
            console.warn('⚠️ [EVENT] Usuario sin acceso:', { userId, eventoId });
            socket.emit('error', { message: 'No tienes acceso a este chat' });
            return;
          }
        }

        // Unirse a la sala
        socket.join(room);
        socket.data = { userId, role, eventoId, userName };

        // Rastrear usuario
        if (!eventUsers.has(eventoId)) {
          eventUsers.set(eventoId, new Map());
        }
        eventUsers.get(eventoId).set(String(userId), {
          userId: String(userId),
          userName,
          role,
          socketId: socket.id
        });

        // Emitir lista actualizada
        const userList = Array.from(eventUsers.get(eventoId).values());
        io.to(room).emit('user_list', userList);

        // Enviar historial
        const historial = await ChatMensaje.findAll({
          where: { evento_id: String(eventoId) },
          order: [['createdAt', 'ASC']],
          limit: 50
        });

        socket.emit('history', historial.map(m => ({
          userId: m.user_id,
          userName: m.user_name,
          role: m.role,
          message: m.message,
          timestamp: m.createdAt
        })));

        socket.to(room).emit('user_joined', { userId, userName, role });
        console.log(`✅ [EVENT] ${userName} (${role}) → sala ${room}`);

      } catch (e) {
        console.warn('⚠️ [EVENT] Error en join_event:', e.message);
        socket.emit('history', []);
      }
    });

    socket.on('send_message', async ({ eventoId, userId, role, userName, message }) => {
      const room = `evento_${eventoId}`;
      console.log('💬 [EVENT] Mensaje grupal:', { eventoId, userId, userName, message, room });

      try {
        const { getModels } = require('../models');
        const { ChatMensaje, Comite, Evento } = getModels();

        // Validar acceso
        if (eventoId !== 'general') {
          const [esMiembro, evento] = await Promise.all([
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

          if (!esMiembro && !esCreador) {
            console.warn('⚠️ [EVENT] Sin permiso para enviar:', { userId, eventoId });
            socket.emit('error', { message: 'No tienes permiso para enviar mensajes' });
            return;
          }
        }

        // Guardar en DB
        await ChatMensaje.create({
          evento_id: String(eventoId),
          user_id: String(userId),
          user_name: userName,
          role,
          message
        });

        io.to(room).emit('receive_message', {
          userId,
          userName,
          role,
          message,
          timestamp: new Date().toISOString()
        });

        console.log('✅ [EVENT] Mensaje emitido a sala:', room);
      } catch (e) {
        console.error('❌ [EVENT] Error en send_message:', e.message);
        socket.emit('error', { message: 'Error al enviar mensaje: ' + e.message });
      }
    });

    socket.on('leave_event', ({ eventoId }) => {
      console.log('🚪 [EVENT] Usuario sale de sala:', eventoId);
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