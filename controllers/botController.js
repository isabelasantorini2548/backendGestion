const axios = require('axios');
const { getModels } = require('../models/index.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

async function askGemini(userMessage, senderInfo = 'Invitado', eventosContexto = "", history = []) {
  const SYSTEM_PROMPT = `Eres el asistente virtual de gestión de eventos de la UNIFRANZ.
📌 REGLAS:
- Responde SOLO con la información del contexto proporcionado.
- Si falta un dato, di: "No tengo información actualizada sobre [tema]".
- Sé conciso (máx 3-4 líneas). Usa formato claro.
- No inventes fechas, responsables ni estados.

📊 CONTEXTO DEL SISTEMA:
${eventosContexto || "Sin eventos activos en este momento."}`;

  // Preparar historial en formato válido para Gemini
  const contents = [];
  
  // Agregar historial previo (alternando user/model)
  for (const msg of history.slice(-6)) {
    contents.push({
      role: msg.role === 'bot' ? 'model' : 'user',
      parts: [{ text: msg.parts?.[0]?.text || msg.text || '' }]
    });
  }
  
  // Agregar mensaje actual del usuario
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  // Probar modelos en orden de preferencia
  for (const modelName of ['gemini-2.0-flash', 'gemini-1.5-flash']) {
    try {
      const model = genAI.getGenerativeModel({ 
        model: modelName,
        systemInstruction: SYSTEM_PROMPT // ← System prompt separado (SDK v0.12+)
      });

      const result = await model.generateContent({ contents });
      return result.response.text();
      
    } catch (err) {
      console.warn(`⚠️ Fallo con ${modelName}:`, err.message);
      // Si falla por systemInstruction no soportado, reintentar sin él
      if (err.message?.includes('systemInstruction')) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });
          // Fallback: prepend system prompt al primer mensaje
          const fallbackContents = [
            { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\nPregunta: ${userMessage}` }] },
            ...contents.slice(1)
          ];
          const result = await model.generateContent({ contents: fallbackContents });
          return result.response.text();
        } catch (fallbackErr) {
          console.warn(`⚠️ Fallback también falló para ${modelName}`);
          continue;
        }
      }
      continue;
    }
  }
  return "⚠️ Servicio temporalmente ocupado. Intenta en unos segundos.";
}

function getMessage() {
  try { return getModels()?.Message || null; } catch { return null; }
}

const appChat = async (req, res) => {
  try {
    const models = getModels();
    const { Evento, Message } = models;
    const { message, sender = 'invitado', eventId, history = [] } = req.body;

    if (!message?.trim()) return res.status(400).json({ error: 'Mensaje vacío' });

    let eventosContexto = "";

    // 🎯 Contexto específico si viene eventId
    if (Evento && eventId) {
      const evento = await Evento.findByPk(eventId, {
        attributes: ['nombreevento', 'fechaevento', 'descripcion', 'lugarevento', 'estado']
      });
      if (evento) {
        eventosContexto = `EVENTO CONSULTADO:\n• Nombre: ${evento.nombreevento}\n• Fecha: ${evento.fechaevento}\n• Lugar: ${evento.lugarevento}\n• Estado: ${evento.estado}\n• Descripción: ${evento.descripcion}`;
      }
    } 
    // 📋 Lista general si no hay eventId
    else if (Evento) {
      const lista = await Evento.findAll({ 
        where: { estado: 'activo' }, 
        limit: 4, 
        attributes: ['nombreevento', 'fechaevento', 'estado'] 
      });
      if (lista.length > 0) {
        eventosContexto = "Eventos activos:\n" + lista.map(e => 
          `- ${e.nombreevento} (${e.fechaevento}) [${e.estado}]`
        ).join('\n');
      }
    }

    const reply = await askGemini(message, sender, eventosContexto, history);

    // 💾 Guardar en BD si el usuario está autenticado
    if (Message && sender !== 'invitado' && sender !== 'anonymous') {
      await Promise.all([
        Message.create({ 
          sender, 
          text: message, 
          role: 'user', 
          eventId: eventId || null, 
          timestamp: new Date() 
        }),
        Message.create({ 
          sender, 
          text: reply, 
          role: 'bot', 
          eventId: eventId || null, 
          timestamp: new Date() 
        })
      ]);
    }

    res.json({ reply, eventId });
  } catch (error) {
    console.error('❌ Error en appChat:', error);
    res.status(500).json({ error: 'Error interno al procesar la solicitud.' });
  }
};

const getMessages = async (req, res) => {
  try {
    const { platform, externalId } = req.params;
    res.json({ platform, externalId, messages: [] });
  } catch { res.status(500).json({ error: 'Error al obtener mensajes' }); }
};

const botStatus = (req, res) => {
  res.json({ status: 'online', platform: 'gemini', timestamp: new Date().toISOString() });
};

const telegramWebhook = async (req, res) => {
  console.log('📩 [TELEGRAM] Webhook recibido');
  console.log('📩 Body:', JSON.stringify(req.body, null, 2));
  
  const { message } = req.body;
  if (!message?.text) return res.sendStatus(200);
  
  const chatId = message.chat.id;
  const text = message.text.trim();
  const senderInfo = message.from?.username ? `@${message.from.username}` : (message.from?.first_name || 'Usuario');

  try {
    // Verificar si es un email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const esEmail = emailRegex.test(text);

    if (esEmail) {
      console.log('📧 Intentando vincular email:', text);
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { email: text.toLowerCase() } 
      });

      console.log('🔍 Usuario encontrado:', usuario ? 'SÍ' : 'NO');

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `❌ Email no encontrado: ${text}\n\nVerifica que sea tu email institucional registrado.`,
        });
        return res.status(200).send('OK');
      }

      // Verificar si ya está vinculado a otro chat
      if (usuario.telegram_chat_id && usuario.telegram_chat_id !== chatId.toString()) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `⚠️ Este email ya está vinculado con otra cuenta de Telegram.\n\nSi necesitas ayuda, contacta al administrador.`,
        });
        return res.status(200).send('OK');
      }

      // Vincular
      await User.update(
        { 
          telegram_chat_id: chatId.toString(),
          telegram_username: message.from.username || message.from.first_name
        },
        { where: { email: text.toLowerCase() } }
      );

      console.log('✅ Cuenta vinculada:', text);

      const successMessage = `
✅ *¡Cuenta vinculada exitosamente!*

Hola ${usuario.nombre} ${usuario.apellidopat || ''}, ahora recibirás notificaciones sobre:

• ✅ Aprobación de eventos
• ❌ Rechazo de eventos (con motivo)
• ⏰ Recordatorios 3 días antes de tu evento

¡Mantente informado! 🎉
      `;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: successMessage,
        parse_mode: 'Markdown'
      });

      return res.status(200).send('OK');
    }

    // Comandos disponibles
    if (text === '/start') {
      const welcomeMessage = `
🤖 *¡Bienvenido al Bot de Eventos UNIFRANZ!*

Para vincular tu cuenta y recibir notificaciones, envía tu email institucional:

Ejemplo: \`juan.perez@unifranz.edu.bo\`

Una vez vinculado, podrás usar:
• /mis_eventos - Ver tus eventos aprobados
• /estado - Verificar si tu cuenta está vinculada
• /ayuda - Mostrar ayuda
      `;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: welcomeMessage,
        parse_mode: 'Markdown'
      });

      return res.status(200).send('OK');
    }

    if (text === '/estado') {
      const models = getModels();
      const { User } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
      } else {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Tu cuenta está vinculada como:\n\n👤 ${usuario.nombre} ${usuario.apellidopat || ''}\n📧 ${usuario.email}\n\nRecibirás notificaciones automáticas.`,
        });
      }

      return res.status(200).send('OK');
    }

    if (text === '/mis_eventos') {
      const models = getModels();
      const { User, Evento } = models;

      const usuario = await User.findOne({ 
        where: { telegram_chat_id: chatId.toString() } 
      });

      if (!usuario) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '❌ Tu cuenta no está vinculada.\n\nEnvía tu email institucional para vincularla.',
        });
        return res.status(200).send('OK');
      }

      const eventos = await Evento.findAll({
        where: { 
          idacademico: usuario.idusuario,
          estado: 'aprobado'
        },
        order: [['fechaevento', 'ASC']],
        limit: 5
      });

      if (eventos.length === 0) {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
          chat_id: chatId,
          text: '📭 No tienes eventos aprobados próximos.',
        });
        return res.status(200).send('OK');
      }

      let message = '📅 *Tus próximos eventos:*\n\n';
      eventos.forEach((evento, index) => {
        const fecha = new Date(evento.fechaevento).toLocaleDateString('es-ES');
        message += `${index + 1}. *${evento.nombreevento}*\n`;
        message += `   🗓️ ${fecha}\n`;
        message += `   📍 ${evento.lugarevento}\n\n`;
      });

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      });

      return res.status(200).send('OK');
    }

    if (text === '/ayuda') {
      const helpMessage = `
📚 *Comandos disponibles:*

/start - Bienvenida e instrucciones
/mis_eventos - Ver tus eventos aprobados
/estado - Verificar vinculación
/ayuda - Mostrar esta ayuda

📧 Para vincular tu cuenta, simplemente envía tu email institucional.
      `;

      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: helpMessage,
        parse_mode: 'Markdown'
      });

      return res.status(200).send('OK');
    }

    // Si no es un comando reconocido
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: '❌ Comando no reconocido.\n\nUsa /ayuda para ver los comandos disponibles.',
    });

  } catch (error) { 
    console.error('❌ [TELEGRAM] Error:', error.message);
    console.error('❌ Stack:', error.stack);
    
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: `❌ Error: ${error.message}\n\nIntenta nuevamente o contacta al administrador.`,
    });
  }
  
  res.status(200).send('OK');
};

const whatsappWebhook = async (req, res) => {
  res.status(200).json({ received: true });
};

const getChatHistory = async (req, res) => {
  try {
    const Message = getMessage();
    const { email } = req.params;
    if (!email || email === 'invitado' || !Message) return res.json({ messages: [] });
    
    const messages = await Message.findAll({
      where: { sender: email },
      order: [['timestamp', 'ASC']],
      limit: 50,
      attributes: ['id', 'text', 'role', 'timestamp'],
    });
    
    res.json({
      messages: messages.map(m => ({
        id: m.id?.toString(),
        text: m.text,
        sender: m.role === 'user' ? 'user' : 'bot',
        timestamp: m.timestamp,
      })),
    });
  } catch (error) {
    console.error('❌ getChatHistory error:', error);
    res.status(500).json({ error: 'Error al cargar el historial' });
  }
};
const enviarNotificacionTelegram = async (evento, tipo) => {
  try {
    const models = getModels();
    const { Evento, User } = models;

    // Obtener el evento completo con el creador
    const eventoCompleto = await Evento.findByPk(evento.idevento || evento.id, {
      include: [
        {
          model: User,
          as: 'academicoCreador',
          attributes: ['idusuario', 'telegram_chat_id']
        }
      ]
    });

    if (!eventoCompleto) {
      console.log('⚠️ Evento no encontrado para notificar');
      return;
    }

    const idAcademico = eventoCompleto.idacademico || eventoCompleto.academicoCreador?.idusuario;
    
    if (!idAcademico) {
      console.log('⚠️ No se encontró idacademico');
      return;
    }

    // Buscar el usuario creador para obtener su telegram_chat_id
    const usuarioCreador = await User.findByPk(idAcademico);

    if (!usuarioCreador || !usuarioCreador.telegram_chat_id) {
      console.log(`⚠️ Usuario ${idAcademico} no tiene telegram_chat_id`);
      return;
    }

    const chatId = usuarioCreador.telegram_chat_id;
    const fechaEvento = new Date(evento.fechaevento).toLocaleDateString('es-ES');
    
    let mensaje = '';
    
    if (tipo === 'aprobado') {
      mensaje = `
✅ *¡Evento Aprobado!*

📅 *${evento.nombreevento}*

🗓️ Fecha: ${fechaEvento}
${evento.horaevento ? `🕐 Hora: ${evento.horaevento}` : ''}
📍 Lugar: ${evento.lugarevento}
👤 Responsable: ${evento.responsable_evento}

¡Tu evento ha sido aprobado exitosamente!
      `;
    } else if (tipo === 'rechazado') {
      mensaje = `
❌ *Evento Rechazado*

📅 *${evento.nombreevento}*

🗓️ Fecha: ${fechaEvento}
📍 Lugar: ${evento.lugarevento}
👤 Responsable: ${evento.responsable_evento}

${evento.razon_rechazo ? `💬 *Motivo:* ${evento.razon_rechazo}` : ''}

Tu evento ha sido rechazado.
      `;
    }

    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: mensaje,
      parse_mode: 'Markdown'
    });

    console.log(`✅ Notificación Telegram enviada a ${chatId}`);
  } catch (error) {
    console.error('❌ Error al enviar notificación Telegram:', error.message);
  }
};

module.exports = {
  getMessages,
  telegramWebhook,
  whatsappWebhook,
  botStatus,
  enviarNotificacionTelegram,
  appChat,
  getChatHistory,
};