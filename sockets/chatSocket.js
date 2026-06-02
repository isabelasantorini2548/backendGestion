// sockets/chatSocket.js
module.exports = (io) => {

  io.on('connection', (socket) => {
    console.log('🔌 Usuario conectado:', socket.id);

    socket.on('join_event', async ({ eventoId, userId, role, userName }) => {
      const room = `evento_${eventoId}`;

      try {
        const { getModels } = require('../models');
        const { ChatMensaje, Comite, Evento } = getModels();

        // Validar acceso si no es sala general
        if (eventoId !== 'general') {
          const [esMiembroComite, evento] = await Promise.all([
            Comite.findOne({
              where: {
                idevento:  parseInt(eventoId),
                idusuario: parseInt(userId)
              }
            }),
            Evento.findOne({
              where: { idevento: parseInt(eventoId) }
            })
          ]);

          const esCreador = evento && parseInt(evento.idacademico) === parseInt(userId);

          if (!esMiembroComite && !esCreador) {
            socket.emit('error', { message: 'No tienes acceso a este chat' });
            return;
          }
        }

        // Unirse a la sala
        socket.join(room);
        socket.data = { userId, role, eventoId, userName };

        // Enviar historial
        const historial = await ChatMensaje.findAll({
          where: { evento_id: String(eventoId) },
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

        socket.to(room).emit('user_joined', { userId, userName, role });
        console.log(`👤 ${userName} (${role}) → sala ${room}`);

      } catch (e) {
        console.warn('⚠️ Error en join_event:', e.message);
        socket.emit('history', []);
      }
    });

    socket.on('send_message', async ({ eventoId, userId, role, userName, message }) => {
      const room = `evento_${eventoId}`;

      try {
        const { getModels } = require('../models');
        const { ChatMensaje, Comite, Evento } = getModels();

        // Validar acceso: comité O creador
        if (eventoId !== 'general') {
          const [esMiembro, evento] = await Promise.all([
            Comite.findOne({
              where: {
                idevento:  parseInt(eventoId),
                idusuario: parseInt(userId)
              }
            }),
            Evento.findOne({
              where: { idevento: parseInt(eventoId) }
            })
          ]);

          const esCreador = evento && parseInt(evento.idacademico) === parseInt(userId);

          if (!esMiembro && !esCreador) {
            socket.emit('error', { message: 'No tienes permiso para enviar mensajes' });
            return;
          }
        }

        // Guardar en DB
        await ChatMensaje.create({
          evento_id: String(eventoId),
          user_id:   String(userId),
          user_name: userName,
          role,
          message
        });

        // Broadcast a todos en la sala
        io.to(room).emit('receive_message', {
          userId,
          userName,
          role,
          message,
          timestamp: new Date().toISOString()
        });

      } catch (e) {
        console.warn('⚠️ Error en send_message:', e.message);
      }
    });

    socket.on('leave_event', ({ eventoId }) => {
      socket.leave(`evento_${eventoId}`);
    });

    socket.on('disconnect', () => {
      console.log('❌ Usuario desconectado:', socket.id);
    });
  });
};