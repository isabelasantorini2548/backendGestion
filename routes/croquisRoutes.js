// backend/routes/croquisRoutes.js
const { Router } =require('express');
const  OpenAI = require('openai');
require('dotenv/config');

const router = Router();

// 🔑 Configura OpenAI con tu API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // ¡Asegúrate de que este valor esté en tu .env!
});

const generarPrompt = (evento) => {
  const actividades = [
    ...evento.actividadesPrevias || [],
    ...evento.actividadesDurante || [],
    ...evento.actividadesPost || []
  ].map(act => act.nombreActividad).filter(Boolean);

  const actividadesTexto = actividades.length > 0 
    ? actividades.join(', ')
    : 'actividades no especificadas';

  return `Croquis esquemático 2D profesional de un evento universitario titulado "${evento.nombreevento || 'Evento Universitario'}", 
  ubicado en "${evento.lugarevento || 'lugar no especificado'}". 
  Fecha: ${evento.fechaevento || 'no especificada'}, Hora: ${evento.horaevento || 'no especificada'}.
  Actividades principales: ${actividadesTexto}.
  Incluye zonas claramente etiquetadas: entrada/preregistro, área principal/presentación, zona de descanso/coffee break, baños, y salida.
  Estilo: plano técnico simple, esquemático, sin personas, colores institucionales (azul universitario y naranja), fondo blanco, texto legible.
  Formato: imagen cuadrada clara y profesional.`;
};

router.post('/generar-croquis', async (req, res) => {
  try {
    const { evento } = req.body;

    if (!evento) {
      return res.status(400).json({ error: 'Se requiere el objeto "evento"' });
    }

    const prompt = generarPrompt(evento);
    console.log('📝 Generando croquis con prompt:', prompt.substring(0, 200) + '...');

    // 🎨 Usa DALL·E 3 (más caro pero mejor calidad)
    const response = await openai.images.generate({
      model: "dall-e-2",          // o "dall-e-2" para ahorrar
      prompt: prompt,
      n: 1,
      size: "1024x1024",
    });

    const imageUrl = response.data[0].url;
    console.log('✅ Croquis generado:', imageUrl);

    res.json({ 
      success: true,
      imageUrl: imageUrl,
      prompt: prompt
    });

  } catch (error) {
    console.error('❌ Error al generar croquis:', error);

    // Manejo de errores comunes
    if (error.status === 401) {
      return res.status(401).json({ error: 'API key de OpenAI inválida o no configurada.' });
    }
    if (error.code === 'billing_hard_limit_reached') {
      return res.status(402).json({ error: 'Límite de gasto alcanzado en OpenAI. Contacta al administrador.' });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Espera un momento.' });
    }

    res.status(500).json({ 
      error: 'No se pudo generar el croquis.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;