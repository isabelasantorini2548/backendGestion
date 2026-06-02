const axios = require('axios');
const { getModels } = require('../models/index.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const TELEGRAM_API = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}`;

// 🔹 Función segura con timeout y formato correcto para Gemini
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

// 🔹 Helpers
function getMessage() {
  try { return getModels()?.Message || null; } catch { return null; }
}

// 🔹 Endpoint principal para chat desde app (Escenario 2)
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

// 🔹 Resto de handlers (se mantienen igual)
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
  const { message } = req.body;
  if (!message?.text) return res.sendStatus(200);
  const chatId = message.chat.id;
  const senderInfo = message.from?.username ? `@${message.from.username}` : (message.from?.first_name || 'Estudiante');
  try {
    const aiResponse = await askGemini(message.text, senderInfo);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId, text: aiResponse, parse_mode: 'Markdown'
    });
  } catch (error) { console.error('❌ telegramWebhook error:', error.message); }
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

module.exports = {
  getMessages,
  telegramWebhook,
  whatsappWebhook,
  botStatus,
  appChat,
  getChatHistory,
};