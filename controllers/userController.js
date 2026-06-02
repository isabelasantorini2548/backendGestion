const  {getModels} = require('../models/index.js');
const  { Op, where } = require('sequelize');
const  bcrypt = require('bcryptjs'); 
const  asyncHandler = require('express-async-handler'); 
const  jwt = require('jsonwebtoken');


const createUser = asyncHandler(async (req, res) => {
  const models = getModels();
  const {User,Academico,Estudiante,Docente} = models;
  const {
    username,
    nombre,
    apellidopat,
    apellidomat,
    email,
    contrasenia, 
    role,
    habilitado,
     idfacultad,     
    idcarrera,      
    idusuarioexterno,
    idestudiante,  
  } = req.body;

  // 1. Validar datos de entrada
  if (!username || !nombre || !apellidopat || !email || !contrasenia || !role) {
    res.status(400);
    throw new Error('Por favor, completa todos los campos requeridos: userName, nombre, apellidopat, email, contrasenia, role.');
  }

  // 2. Verificar si el email o userName ya existen
  const emailExists = await User.findOne({ where: { email } });
  if (emailExists) {
    res.status(400);
    throw new Error('El correo electrónico ya está registrado.');
  }

  const userNameExists = await User.findOne({ where: { username } });
  if (userNameExists) {
    res.status(400);
    throw new Error('El nombre de usuario ya está en uso.');
  }

  // 3. Hashear la contraseña
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(contrasenia, salt);

  // 4. Crear el usuario en la base de datos
  const newUser = await User.create({
    username,
    nombre,
    apellidopat,
    apellidomat: apellidomat || null,
    email,
    contrasenia,
    role,
    habilitado: habilitado !== undefined ? habilitado : true,
  });

   if (!newUser) {
    res.status(400);
    throw new Error('No se pudo crear el usuario.');
  }

  // ✅ Crear registro según el rol
  if (role === 'academico') {
    if (!idcarrera || !idfacultad) {
      res.status(400);
      throw new Error('idcarrera e idfacultad son requeridos para el rol academico.');
    }
    await Academico.create({
      idusuario: newUser.idusuario,
      idcarrera: idcarrera,
      facultad_id: idfacultad, // ← aquí se mapea idfacultad → facultad_id del modelo
    });
  } else if (role === 'student') {
    if (!idcarrera) {
      res.status(400);
      throw new Error('idcarrera es requerido para el rol student.');
    }
    await Estudiante.create({
      idusuario: newUser.idusuario,
      idcarrera: idcarrera,
    });
  } else if (role === 'docente') {
    if (!carreras_ids || carreras_ids.length === 0) {
      res.status(400);
      throw new Error('carreras_ids es requerido para el rol docente.');
    }
    // Si tienes una tabla docente_carrera (relación muchos a muchos)
    for (const cid of carreras_ids) {
      await Docente.create({
        idusuario: newUser.idusuario,
        idcarrera: cid,
      });
    }
  }

  res.status(201).json({
    idusuario: newUser.idusuario,
    username: newUser.username,
    nombre: newUser.nombre,
    apellidopat: newUser.apellidopat,
    apellidomat: newUser.apellidomat,
    email: newUser.email,
    role: newUser.role,
    habilitado: newUser.habilitado,
  });
  
});

const getAllUsers = asyncHandler(async (req, res) => {
  const models = getModels();
  const {User,Academico, Carrera} = models;
  const users = await User.findAll({
     include: [
    {
      model: Academico,
      as: 'academico',
      include: [{
        model: Carrera,
        as: 'carrera',
        attributes: ['nombreCarrera'] // Solo el nombre de la carrera
      }],
       attributes: []
  }
  ],
  attributes: { exclude: ['contrasenia'] } // Excluye la contraseña por seguridad
});
  res.status(200).json(users);
});

const getCarrera= asyncHandler(async (req,res)=>{
  try {
      const models =  getModels();
      const {Carrera} = models;
    const carreras = await Carrera.findAll(); // Suponiendo que usas un ORM como Sequelize
    res.status(200).json(carreras);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener carreras', error });
  }
});
const getUserProfile = asyncHandler(async (req, res) => {
  try {
    // Usar idusuario que es tu PK real
    const userId = req.user.idusuario; 
    const models = getModels();
    const { User, Facultad } = models;

    const user = await User.findByPk(userId, {
      include: [{
        model: Facultad,
        as: 'facultad', // Asegúrate de que este alias esté en tu index.js
        attributes: ['nombre_facultad']
      }],
      attributes: { exclude: ['contrasenia'] }
    });

    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

    res.json({
      id: user.idusuario,
      nombre: user.nombre,
      apellidopat: user.apellidopat,
      apellidomat: user.apellidomat,
      email: user.email,
      role: user.role,
      facultad: user.facultad?.nombre_facultad || 'Sin facultad',
      facultad_id: user.facultad_id
    });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener perfil', error: error.message });
  }
});
const getUserById = asyncHandler(async (req, res) => {
   const models = getModels();
  const {User} = models;
  try {
    const { id } = req.params; // ✅ Obtiene el ID de la URL
    
    console.log('Backend: Consultando usuario con ID:', id);

    if (!id) {
      return res.status(400).json({ message: 'ID de usuario requerido' });
    }

    const user = await User.findByPk(id, {
      attributes: { exclude: ['contrasenia'] } // No enviar la contraseña
    });

    if (!user) {
      console.log('Backend: Usuario no encontrado con ID:', id);
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    console.log('Backend: Usuario encontrado:', user.toJSON());

    // ✅ Enviar respuesta en el formato que espera el frontend
    res.status(200).json({
      user: {
        idusuario: user.idusuario,
        username: user.username,
        nombre: user.nombre,
        apellidopat: user.apellidopat,
        apellidomat: user.apellidomat,
        email: user.email,
        role: user.role,
        habilitado: user.habilitado
      }
    });
  } catch (error) {
    console.error('Error en getUserById:', error);
    res.status(500).json({ 
      message: 'Error al obtener usuario',
      error: error.message 
    });
  }
});

const getUserById1 = asyncHandler(async (req, res) => {
     const models = getModels();
  const {User} = models;
  const user = await User.findByPk(req.params.id, {
    attributes: { exclude: ['contrasenia'] }, // Excluir 'contrasenia'
  });

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado.');
  }
  res.status(200).json(user);
});

const updateUser = asyncHandler(async (req, res) => {
  const models = getModels();
  const {User, Academico, Estudiante} = models;
  
  try {
    const { id } = req.params;
    const { username, nombre, apellidopat, apellidomat, email, role, habilitado, contrasenia, idcarrera, idfacultad } = req.body;

    console.log('🔥 [updateUser] ID:', id);
    console.log('🔥 [updateUser] idfacultad recibido:', idfacultad);
    console.log('🔥 [updateUser] idcarrera recibido:', idcarrera);

    if (!id) {
      return res.status(400).json({ message: 'ID de usuario requerido' });
    }

    const user = await User.findByPk(id);
    if (!user) {
      console.error('❌ Usuario no encontrado:', id);
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Verificar email duplicado
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ where: { email } });
      if (existingEmail) return res.status(409).json({ message: 'El email ya está en uso' });
    }

    // Actualizar campos básicos
    if (nombre) user.nombre = nombre;
    if (apellidopat) user.apellidopat = apellidopat;
    if (apellidomat !== undefined) user.apellidomat = apellidomat;
    if (email) user.email = email;

     if (habilitado !== undefined) {
      // Convertir a booleano o número según el tipo de tu BD
      let valorHabilitado;
      
      if (typeof habilitado === 'string') {
        // Si viene como string "true", "false", "1", "0"
        valorHabilitado = habilitado === 'true' || habilitado === '1' || habilitado === 't' ? 1 : 0;
      } else if (typeof habilitado === 'boolean') {
        // Si viene como booleano true/false
        valorHabilitado = habilitado ? 1 : 0;
      } else {
        // Si ya es número (1 o 0)
        valorHabilitado = habilitado ? 1 : 0;
      }
      
      console.log('📝 Actualizando habilitado a:', valorHabilitado);
      user.habilitado = valorHabilitado;
    }

    if (contrasenia && contrasenia.trim() !== '') {
      //const salt = await bcrypt.genSalt(10);
      user.contrasenia =contrasenia.trim();
      // await bcrypt.hash(contrasenia, salt);
    }

    // ✅ ACTUALIZAR facultad_id en tabla usuario (si existe la columna)
    if (user.role === 'academico' && idfacultad) {
      console.log('📝 Actualizando usuario.facultad_id a:', idfacultad);
      user.facultad_id = idfacultad;
    }

    await user.save();
    console.log('✅ Usuario guardado correctamente');

    // ✅ ACTUALIZAR/CREAR registro en academico o estudiante
    if (idcarrera && user.role === 'academico') {
      console.log('📝 Buscando/creando registro en academico...');
      
      let academico = await Academico.findOne({ where: { idusuario: id } });
      
      if (academico) {
        // Actualizar existente
        console.log('✏️ Actualizando registro existente en academico');
        academico.idcarrera = idcarrera;
        
        // Verificar si la columna existe antes de asignar
        if (academico.facultad_id !== undefined) {
          academico.facultad_id = idfacultad;
          console.log('📝 academico.facultad_id =', idfacultad);
        }
        
        await academico.save();
        console.log('✅ Academico actualizado:', academico.toJSON());
      } else {
        // Crear nuevo
        console.log('➕ Creando nuevo registro en academico');
        academico = await Academico.create({
          idusuario: id,
          idcarrera: idcarrera,
          facultad_id: idfacultad || null
        });
        console.log('✅ Academico creado:', academico.toJSON());
      }
    } else if (idcarrera && user.role === 'student') {
      console.log('📝 Buscando/creando registro en estudiante...');
      
      let estudiante = await Estudiante.findOne({ where: { idusuario: id } });
      
      if (estudiante) {
        estudiante.idcarrera = idcarrera;
        await estudiante.save();
        console.log('✅ Estudiante actualizado');
      } else {
        estudiante = await Estudiante.create({
          idusuario: id,
          idcarrera: idcarrera
        });
        console.log('✅ Estudiante creado');
      }
    }

    // Respuesta final
    const updatedUser = await User.findByPk(id, {
      attributes: { exclude: ['contrasenia'] }
    });

    res.status(200).json({
      message: 'Usuario actualizado correctamente',
      user: updatedUser,
      debug: {
        facultad_id_usuario: updatedUser.facultad_id,
        idcarrera_enviado: idcarrera,
        idfacultad_enviado: idfacultad
      }
    });

  } catch (error) {
    console.error('❌ Error en updateUser:', error);
    console.error('❌ Stack:', error.stack);
    res.status(500).json({ 
      message: 'Error al actualizar el usuario', 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

const getDirectoresCarrera = asyncHandler(async(req, res) => {
   const models = getModels();
  const {User,Role} = models;
  try{ 
  const directorRole = await Role.findOne({
      where: { nombrerol: 'Director de carrera' }
    });
  if (!directorRole) {
      res.status(404);
      throw new Error('Rol "Director de carrera" no encontrado.');
    }

    const directores = await User.findAll({
      attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat'],
      include: [{
        model: Role,
        where: { idrol: directorRole.idrol },
        through: { attributes: [] } // No incluir atributos de la tabla de unión
      }],
      limit: 5, // Según tu consulta original
    });

    // Formatea la respuesta para que coincida con el 'nombreCompleto' esperado por tu frontend
    const formattedDirectores = directores.map(director => ({
      id: director.idusuario,
      nombreCompleto: `${director.nombre} ${director.apellidopat} ${director.apellidomat ? director.apellidomat : ''}`.trim()
    }));

    res.status(200).json(formattedDirectores);
  } catch (error) {
    console.error('Error al obtener directores de carrera:', error);
    res.status(500).json({ message: 'Error en el servidor', error: error.message });
  }

});


const deleteUserByAdmin = asyncHandler(async (req, res) => {
   const models = getModels();
  const {User} = models;
  const { id } = req.params;
  const user = await User.findByPk(id);

  if (!user) {
    res.status(404);
    throw new Error('Usuario no encontrado.');
  }

  if (user.idusuario === req.user.idusuario) { // Compara con la PK correcta
    res.status(400);
    throw new Error('No puedes eliminar tu propia cuenta de administrador.');
  }

  await user.destroy();
  res.status(200).json({ message: 'Usuario eliminado exitosamente.' });
});

const getComite = asyncHandler(async (req, res) => {
  const models = getModels();
  const { sequelize } = models;

  try {
    const [results] = await sequelize.query(`
      SELECT 
        u.idusuario,
        u.nombre,
        u.apellidopat,
        u.apellidomat,
        u.email,
        u.role,
        f.nombre_facultad AS facultad
      FROM usuario u
      LEFT JOIN academico a ON u.idusuario = a.idusuario
      LEFT JOIN facultad f ON a.facultad_id = f.facultad_id
      WHERE u.role = 'academico' 
        AND u.habilitado = 'true'
      ORDER BY u.nombre, u.apellidopat
    `);


    console.log('✅ Usuarios encontrados:', results.length);

    const usuariosFormateados = results.map(row => ({
      id: row.idusuario,
      nombreCompleto: `${row.nombre || ''} ${row.apellidopat || ''} ${row.apellidomat || ''}`.trim(),
      email: row.email,
      role: row.role,
      facultad: row.facultad || null,
      carrera: row.carrera || null
    }));

    res.status(200).json(usuariosFormateados);

  } catch (error) {
    console.error('❌ Error al obtener comité:', error.message);
    res.status(500).json({ 
      message: 'Error interno del servidor',
      detail: error.message  // ← Verás el error exacto en el frontend
    });
  }
});
const getComiteUser = asyncHandler(async (req, res) => {
  const models = getModels();
  const { sequelize } = models;

  try {
    const [results] = await sequelize.query(`
      SELECT 
        u.idusuario,
        u.nombre,
        u.apellidopat,
        u.apellidomat,
        u.email,
        u.role,
		u.habilitado,
        f.nombre_facultad AS facultad
      FROM usuario u
      LEFT JOIN academico a ON u.idusuario = a.idusuario
      LEFT JOIN facultad f ON a.facultad_id = f.facultad_id
      WHERE u.role = 'academico' AND u.habilitado::text = '1'
      ORDER BY u.nombre, u.apellidopat
    `);

    // ✅ Formatear directamente desde 'results'
    const usuariosFormateados = results.map(row => ({
      id: row.idusuario,
      nombreCompleto: `${row.nombre || ''} ${row.apellidopat || ''} ${row.apellidomat || ''}`.trim(),
      email: row.email,
      role: row.role,
      facultad: row.facultad || null  // <-- viene directo de la columna 'f.nombre_facultad AS facultad'
    }));

    res.status(200).json(usuariosFormateados);
  } catch (error) {
    console.error('Error al obtener usuarios para comité:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});
 const getId = asyncHandler(async(req, res)=>{
  try {
    const { id } = req.params;

    // Asegúrate de que el ID sea un entero
    const userId = parseInt(id);
    if (isNaN(userId)) {
      return res.status(400).json({ message: 'ID de usuario inválido' });
    }

    const query = `
      SELECT 
        u.idusuario, 
        u.username, 
        u.email, 
        u.role, 
        u.habilitado,
        a.idarea AS area_id,
        c.idcarrera AS carrera_id,
        c.nombrecarrera
      FROM usuario u
      LEFT JOIN academico a ON u.idusuario = a.idusuario
      LEFT JOIN carrera c ON a.idcarrera = c.idcarrera
      WHERE u.idusuario = ?
    `;

    const [rows] = await db.query(query, [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const user = rows[0];

    // Formatear el objeto para incluir datos anidados si es académico
    const response = {
      idusuario: user.idusuario,
      username: user.username,
      email: user.email,
      role: user.role,
      habilitado: user.habilitado,
    };

    if (user.role === 'academico') {
      response.academico = {
        idarea: user.area_id,
        carrera: user.carrera_id
          ? { idcarrera: user.carrera_id, nombrecarrera: user.nombrecarrera }
          : null,
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

const linkTelegramAccount = asyncHandler(async (req, res) => {
   const models = getModels();
  const {User} = models;
  
  const { email, chat_id } = req.body;

  // 1. Validar la entrada
  if (!email || !chat_id) {
    res.status(400);
    throw new Error('Faltan el email o el chat_id.');
  }

  const user = await User.findOne({ where: { email } });

  const token = jwt.sign(
    { id: user.id }, // ✅ Usa "id", no "idusuario"
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  if (!user) {
    res.status(404);
    throw new Error('No se encontró ningún usuario con ese email. Por favor, verifica que lo hayas escrito correctamente.');
  }

  if (user.telegram_chat_id) {
    if (user.telegram_chat_id == chat_id) {
      return res.status(200).json({ message: 'Esta cuenta ya estaba vinculada correctamente.' });
    } else {
      res.status(409); 
      throw new Error('Este email ya está vinculado a otra cuenta de Telegram.');
    }
  }
  
  // 4. Si el usuario existe, actualizar su registro con el chat_id
  user.telegram_chat_id = chat_id;
  await user.save(); // Guardar los cambios en la base de datos

  // 5. Enviar una respuesta de éxito
  res.status(200).json({
    message: `¡Éxito! Tu cuenta (${user.email}) ha sido vinculada. Ahora recibirás notificaciones.`
  });
});

 const getProfile = asyncHandler(async (req, res) => {
  
    if (!req.user.idusuario) {
    return res.status(401).json({ message: 'No autorizado: usuario no autenticado' });
  }

  const userId = req.user.idusuario;
  if (!userId) {
    console.error('req.user no tiene idusuario:', req.user);
    return res.status(500).json({ message: 'Error: usuario autenticado sin ID válido' });
  }

  const models = getModels();
  const { User, Facultad } = models; // o 'User', según el nombre real de tu modelo

  try {
    const user = await User.findByPk(userId,{
      attributes: ['idusuario', 'nombre', 'apellidopat', 'apellidomat', 'email', 'role', 'facultad_id'],
      include: [
        {
          model: Facultad,
          as: 'facultad', // debe coincidir con el alias de la asociación
          attributes: ['nombre_facultad']
        }
      ]
    });

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json({
      id: user.idusuario,
      nombre: user.nombre,
      apellidopat: user.apellidopat,
      apellidomat: user.apellidomat,
      email: user.email,
      role: user.role,
      facultad: user.facultad?.nombre_facultad || 'Sin facultad',
      facultad_id: user.facultad_id
    });

  } catch (error) {
    console.error('Error al obtener perfil:', error);
    res.status(500).json({ 
      message: 'Error al obtener el perfil del usuario',
      error: error.message 
    });
  }
  
});
const getFacultades = asyncHandler(async(req,res)=>{
try{
  const models = getModels();
  const {Facultad} = models;
  const facultad = await Facultad.findAll();
  res.status(200).json(facultad);

}catch(error){
  res.status(500).json({message: 'Error al obtener', error})

}

});
const getUserByEmail = asyncHandler(async (req, res) => {
  const models = getModels();
  const { User } = models;
  const { email } = req.params;

  const user = await User.findOne({ 
    where: { email },
    attributes: ['idusuario', 'nombre', 'telegram_chat_id'] 
  });

  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado' });
  }

  res.status(200).json(user);
});
module.exports = {
  createUser,
  getAllUsers,  
  getUserById,
  getUserById1,
  updateUser,
  getDirectoresCarrera,
  deleteUserByAdmin,
  getComite,
  getComiteUser,
  getId,
  linkTelegramAccount,
  getProfile,
  getFacultades,
  getCarrera,
  getUserProfile,
  getUserByEmail
};